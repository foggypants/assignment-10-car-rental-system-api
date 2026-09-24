const supabase = require('../config/supabase');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

const register = asyncHandler(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) throw new HttpError(400, 'email, password and name are required');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw new HttpError(400, error.message);

  res.status(201).json({
    message: 'Registration successful. If email confirmation is enabled, confirm your email before logging in.',
    user: { id: data.user?.id, email: data.user?.email, name },
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'email and password are required');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new HttpError(401, 'Invalid email or password');

  res.status(200).json({
    access_token: data.session.access_token,
    expires_at: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name },
  });
});

module.exports = { register, login };
