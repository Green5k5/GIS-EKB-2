// Source: the estate 969 correction in branch vladimir-table.
export const estate969 = {
  lat: 56.8467616, lng: 60.5871053,
  geometry: { type: 'Polygon', coordinates: [[
    [60.5867690, 56.8467592], [60.5873622, 56.8469094],
    [60.5873958, 56.8468670], [60.5874335, 56.8468326],
    [60.5874732, 56.8468130], [60.5868459, 56.8465036],
    [60.5867941, 56.8466491], [60.5867690, 56.8467592],
  ]] },
};

// Only repair the original missing contour and placeholder coordinates.
// Preserve later manual placements, pending workspace edits and old releases.
export function repairEstate969(db) {
  const legacy = (r, plotId) => !plotId && Number(r.lat) === 56.8389 && Number(r.lng) === 60.6057;
  const record = db.prepare("SELECT * FROM records WHERE settlement_id='ekb' AND num='969' AND status='active'").get();
  const release = db.prepare('SELECT id,snapshot_json FROM releases ORDER BY id DESC LIMIT 1').get();
  const published = release ? JSON.parse(release.snapshot_json) : null;
  const publishedRecord = published?.records?.find(r => r.settlementId === 'ekb' && String(r.num) === '969');
  const fixWorkspace = record && legacy(record, record.plot_id);
  const fixPublished = publishedRecord && legacy(publishedRecord, publishedRecord.plotId);
  if (!fixWorkspace && !fixPublished) return false;
  // A user-supplied contour takes precedence over this source-data correction.
  if (db.prepare("SELECT id FROM plots WHERE settlement_id='ekb' AND legacy_key='969'").get()) return false;
  db.exec('BEGIN');
  try {
    const inserted = db.prepare('INSERT INTO plots(settlement_id,legacy_key,geometry_json,focus_lat,focus_lng) VALUES(?,?,?,?,?)')
      .run('ekb', '969', JSON.stringify(estate969.geometry), estate969.lat, estate969.lng);
    const plotId = Number(inserted.lastInsertRowid);
    if (fixWorkspace) db.prepare('UPDATE records SET lat=?,lng=?,plot_id=? WHERE id=?')
      .run(estate969.lat, estate969.lng, plotId, record.id);
    if (fixPublished) {
      Object.assign(publishedRecord, { lat: estate969.lat, lng: estate969.lng, plotId });
      published.plots.push({ id: plotId, settlementId: 'ekb', legacyKey: '969', geometry: estate969.geometry,
        focusLat: estate969.lat, focusLng: estate969.lng });
      db.prepare('INSERT INTO releases(snapshot_json,note) VALUES(?,?)').run(JSON.stringify(published), 'Исправлены координаты и контур усадьбы №969 (Екатеринбург)');
    }
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
