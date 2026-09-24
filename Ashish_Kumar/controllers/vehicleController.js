const supabase = require('../config/supabase');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

const CATEGORIES = ['Sedan', 'SUV', 'Luxury', 'Hatchback', 'Electric'];
const STATUSES = ['available', 'rented', 'maintenance'];
const UPDATABLE = ['brand', 'model', 'year', 'category', 'daily_rate', 'fuel_type', 'seating_capacity', 'status'];

function validateVehicleFields(b, { partial }) {
  const required = ['brand', 'model', 'year', 'category', 'daily_rate', 'fuel_type'];
  if (!partial) {
    const missing = required.filter((f) => b[f] === undefined || b[f] === '');
    if (missing.length) throw new HttpError(400, `Missing required fields: ${missing.join(', ')}`);
  }
  if (b.category !== undefined && !CATEGORIES.includes(b.category))
    throw new HttpError(400, `category must be one of: ${CATEGORIES.join(', ')}`);
  if (b.status !== undefined && !STATUSES.includes(b.status))
    throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
  if (b.daily_rate !== undefined && !(Number(b.daily_rate) > 0))
    throw new HttpError(400, 'daily_rate must be a positive number');
  if (b.year !== undefined && !Number.isInteger(Number(b.year)))
    throw new HttpError(400, 'year must be an integer');
  if (b.seating_capacity !== undefined && !(Number.isInteger(Number(b.seating_capacity)) && Number(b.seating_capacity) > 0))
    throw new HttpError(400, 'seating_capacity must be a positive integer');
}

const listVehicles = asyncHandler(async (req, res) => {
  const { category, status } = req.query;
  if (category && !CATEGORIES.includes(category)) throw new HttpError(400, `Invalid category. Use: ${CATEGORIES.join(', ')}`);
  if (status && !STATUSES.includes(status)) throw new HttpError(400, `Invalid status. Use: ${STATUSES.join(', ')}`);

  let query = supabase.from('vehicles').select('*').order('id');
  if (category) query = query.eq('category', category);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  res.status(200).json({ count: data.length, vehicles: data });
});

const getVehicle = asyncHandler(async (req, res) => {
  // Relational join: vehicle + its rental history. Customer PII is intentionally not exposed on this public route.
  const { data, error } = await supabase
    .from('vehicles')
    .select('*, rentals(id, start_date, end_date, status, created_at)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  res.status(200).json(data);
});

const createVehicle = asyncHandler(async (req, res) => {
  const body = req.body || {};
  validateVehicleFields(body, { partial: false });

  const row = {};
  UPDATABLE.forEach((f) => { if (body[f] !== undefined) row[f] = body[f]; });

  const { data, error } = await supabase.from('vehicles').insert(row).select().single();
  if (error) throw new HttpError(400, error.message);
  res.status(201).json(data);
});

const updateVehicle = asyncHandler(async (req, res) => {
  const body = req.body || {};
  validateVehicleFields(body, { partial: true });

  const updates = {};
  UPDATABLE.forEach((f) => { if (body[f] !== undefined) updates[f] = body[f]; });
  if (!Object.keys(updates).length) throw new HttpError(400, 'No valid fields to update');

  const { data, error } = await supabase.from('vehicles').update(updates).eq('id', req.params.id).select().maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, 'Vehicle not found');
  res.status(200).json(data);
});

const deleteVehicle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: vehicle, error: vErr } = await supabase.from('vehicles').select('id').eq('id', id).maybeSingle();
  if (vErr) throw vErr;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');

  const { count, error: cErr } = await supabase
    .from('rentals')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', id)
    .in('status', ['booked', 'active']);
  if (cErr) throw cErr;
  if (count > 0) throw new HttpError(400, 'Cannot delete: vehicle has active or upcoming bookings');

  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) {
    // 23503 = FK violation (completed/cancelled rentals still reference this vehicle; ON DELETE RESTRICT)
    if (error.code === '23503') throw new HttpError(400, 'Cannot delete: vehicle has rental history. Set status to "maintenance" instead.');
    throw error;
  }
  res.status(200).json({ message: 'Vehicle deleted' });
});

module.exports = { listVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle };
