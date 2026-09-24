const supabase = require('../config/supabase');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parses a strict YYYY-MM-DD string into a UTC timestamp (null if invalid).
function parseDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const t = Date.parse(`${str}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== str) return null;
  return t;
}

// Inclusive day count: 2026-05-01 -> 2026-05-05 = 5 rental days (same-day rental = 1 day).
function countDays(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / MS_PER_DAY) + 1;
}

const today = () => new Date().toISOString().slice(0, 10);

/*
 * Date-range overlap: two inclusive ranges [aStart, aEnd] and [bStart, bEnd] overlap
 * if and only if  aStart <= bEnd  AND  aEnd >= bStart.
 * We look for existing booked/active rentals of the same vehicle that satisfy this against the requested range.
 */
async function findConflicts(vehicleId, start, end) {
  const { data, error } = await supabase
    .from('rentals')
    .select('id, start_date, end_date')
    .eq('vehicle_id', vehicleId)
    .in('status', ['booked', 'active'])
    .lte('start_date', end)
    .gte('end_date', start);
  if (error) throw error;
  return data;
}

const createRental = asyncHandler(async (req, res) => {
  const { vehicle_id, start_date, end_date, customer_name, customer_email } = req.body || {};

  if (!vehicle_id || !start_date || !end_date || !customer_name || !customer_email)
    throw new HttpError(400, 'vehicle_id, start_date, end_date, customer_name and customer_email are required');
  if (parseDate(start_date) === null || parseDate(end_date) === null)
    throw new HttpError(400, 'Dates must be valid and formatted as YYYY-MM-DD');
  if (parseDate(end_date) < parseDate(start_date))
    throw new HttpError(400, 'end_date must be on or after start_date');
  if (!/^\S+@\S+\.\S+$/.test(customer_email)) throw new HttpError(400, 'customer_email is not a valid email');

  const { data: vehicle, error: vErr } = await supabase.from('vehicles').select('*').eq('id', vehicle_id).maybeSingle();
  if (vErr) throw vErr;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  if (vehicle.status === 'maintenance') throw new HttpError(400, 'Vehicle is under maintenance and cannot be booked');

  const conflicts = await findConflicts(vehicle.id, start_date, end_date);
  if (conflicts.length) throw new HttpError(400, 'Vehicle already reserved during this timeframe');

  const days = countDays(start_date, end_date);
  const total_cost = Number((days * Number(vehicle.daily_rate)).toFixed(2));

  // A rental that starts today (or earlier) and hasn't ended is immediately active.
  const t = today();
  const isActiveNow = start_date <= t && end_date >= t;

  const { data: rental, error } = await supabase
    .from('rentals')
    .insert({
      user_id: req.user.id,
      vehicle_id: vehicle.id,
      customer_name,
      customer_email,
      start_date,
      end_date,
      total_cost,
      status: isActiveNow ? 'active' : 'booked',
    })
    .select()
    .single();

  if (error) {
    // 23P01 = exclusion violation from the DB-level guard (a concurrent request won the race)
    if (error.code === '23P01') throw new HttpError(400, 'Vehicle already reserved during this timeframe');
    throw error;
  }

  if (isActiveNow) await supabase.from('vehicles').update({ status: 'rented' }).eq('id', vehicle.id);

  res.status(201).json({
    ...rental,
    billing: { days, daily_rate: Number(vehicle.daily_rate), total_cost },
  });
});

const myBookings = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('rentals')
    .select('*, vehicles(id, brand, model, year, category)')
    .eq('user_id', req.user.id)
    .order('start_date', { ascending: false });
  if (error) throw error;
  res.status(200).json({ count: data.length, rentals: data });
});

// Loads a rental and ensures the authenticated user owns it.
async function getOwnedRental(id, userId) {
  const { data, error } = await supabase.from('rentals').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Rental not found');
  if (data.user_id !== userId) throw new HttpError(403, 'You do not own this rental');
  return data;
}

const cancelRental = asyncHandler(async (req, res) => {
  const rental = await getOwnedRental(req.params.id, req.user.id);

  if (rental.status !== 'booked') throw new HttpError(400, `Cannot cancel a rental with status "${rental.status}". Only upcoming bookings can be cancelled.`);
  if (rental.start_date <= today()) throw new HttpError(400, 'Cannot cancel a rental that has already started');

  const { data, error } = await supabase.from('rentals').update({ status: 'cancelled' }).eq('id', rental.id).select().single();
  if (error) throw error;
  res.status(200).json(data);
});

const completeRental = asyncHandler(async (req, res) => {
  const rental = await getOwnedRental(req.params.id, req.user.id);

  if (!['booked', 'active'].includes(rental.status))
    throw new HttpError(400, `Cannot complete a rental with status "${rental.status}"`);

  const { data, error } = await supabase.from('rentals').update({ status: 'completed' }).eq('id', rental.id).select().single();
  if (error) throw error;

  // Car returned: make it available again (unless it was sent to maintenance meanwhile).
  await supabase.from('vehicles').update({ status: 'available' }).eq('id', rental.vehicle_id).eq('status', 'rented');

  res.status(200).json(data);
});

module.exports = { createRental, myBookings, cancelRental, completeRental, countDays, parseDate };
