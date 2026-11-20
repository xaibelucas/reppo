// Supabase Client Adapter for Academia Tracker
// Connects to PostgreSQL database via Supabase PostgREST API with Zero external dependencies!

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://auozyptlgtwkzwtwvotx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_F21MGNFu0zkl4XSuKPQZXQ_MBpxKpQp';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

async function apiFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }

  if (!res.ok) {
    const errorMsg = data && data.message ? data.message : `HTTP ${res.status}`;
    const err = new Error(errorMsg);
    err.status = res.status;
    err.details = data;
    throw err;
  }

  return data;
}

// -------------------------------------------------------------
// PROFILES & AUTH
// -------------------------------------------------------------

async function getProfileByEmail(email) {
  const normalized = email.trim().toLowerCase();
  const rows = await apiFetch(`profiles?email=eq.${encodeURIComponent(normalized)}&select=*`);
  if (!rows || rows.length === 0) return null;
  return toUserProfile(rows[0]);
}

async function getProfileById(id) {
  const rows = await apiFetch(`profiles?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows || rows.length === 0) return null;
  return toUserProfile(rows[0]);
}

async function createProfile(userData) {
  const payload = {
    id: userData.id,
    name: userData.name,
    email: userData.email.trim().toLowerCase(),
    password_hash: userData.passwordHash,
    salt: userData.salt,
    current_weight: userData.profile?.currentWeight || null,
    height: userData.profile?.height || null,
    goal: userData.profile?.goal || 'Hipertrofia',
    experience_level: userData.profile?.experienceLevel || 'Intermediário',
    weight_history: userData.profile?.weightHistory || []
  };

  const rows = await apiFetch('profiles', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });

  return rows && rows[0] ? toUserProfile(rows[0]) : null;
}

async function updateProfile(id, updates) {
  const payload = {};
  if (updates.name) payload.name = updates.name.trim();
  if (updates.goal) payload.goal = updates.goal;
  if (updates.height !== undefined) payload.height = updates.height;
  if (updates.experienceLevel) payload.experience_level = updates.experienceLevel;
  if (updates.currentWeight !== undefined) payload.current_weight = updates.currentWeight;
  if (updates.weightHistory) payload.weight_history = updates.weightHistory;

  const rows = await apiFetch(`profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });

  return rows && rows[0] ? toUserProfile(rows[0]) : null;
}

function toUserProfile(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    salt: row.salt,
    profile: {
      currentWeight: row.current_weight !== null ? parseFloat(row.current_weight) : null,
      height: row.height !== null ? parseFloat(row.height) : null,
      goal: row.goal || 'Hipertrofia',
      experienceLevel: row.experience_level || 'Intermediário',
      weightHistory: row.weight_history || []
    }
  };
}

// -------------------------------------------------------------
// SESSIONS
// -------------------------------------------------------------

async function createSession(token, userId) {
  await apiFetch('sessions', {
    method: 'POST',
    body: JSON.stringify({ token, user_id: userId })
  });
}

async function getSessionUserId(token) {
  const rows = await apiFetch(`sessions?token=eq.${encodeURIComponent(token)}&select=user_id`);
  if (!rows || rows.length === 0) return null;
  return rows[0].user_id;
}

async function deleteSession(token) {
  await apiFetch(`sessions?token=eq.${encodeURIComponent(token)}`, {
    method: 'DELETE'
  });
}

// -------------------------------------------------------------
// EXERCISES
// -------------------------------------------------------------

async function getExercisesForUser(userId) {
  // Query all base exercises + user's custom exercises
  let query = 'exercises?select=*';
  if (userId) {
    query += `&or=(is_base.eq.true,user_id.is.null,user_id.eq.${encodeURIComponent(userId)})`;
  } else {
    query += '&or=(is_base.eq.true,user_id.is.null)';
  }

  const rows = await apiFetch(query);
  return (rows || []).map(r => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    muscle: r.muscle,
    equipment: r.equipment,
    machineSettings: r.machine_settings,
    notes: r.notes,
    targetRepMin: r.target_rep_min,
    targetRepMax: r.target_rep_max,
    isBase: r.is_base
  }));
}

async function syncUserExercises(userId, exercises) {
  if (!Array.isArray(exercises)) return;

  // 1. Delete previous custom exercises of this user
  await apiFetch(`exercises?user_id=eq.${encodeURIComponent(userId)}&is_base=eq.false`, {
    method: 'DELETE'
  });

  // 2. Insert new custom exercises
  const custom = exercises.filter(e => !e.isBase).map(e => ({
    id: e.id,
    user_id: userId,
    name: e.name,
    muscle: e.muscle,
    equipment: e.equipment || '',
    machine_settings: e.machineSettings || '',
    notes: e.notes || '',
    target_rep_min: e.targetRepMin || 8,
    target_rep_max: e.targetRepMax || 12,
    is_base: false
  }));

  if (custom.length > 0) {
    await apiFetch('exercises', {
      method: 'POST',
      body: JSON.stringify(custom)
    });
  }
}

// -------------------------------------------------------------
// ROUTINES
// -------------------------------------------------------------

async function getRoutinesForUser(userId) {
  if (!userId) return { userRoutines: [], sharedRoutines: [] };

  // Fetch all routines
  const rows = await apiFetch('routines?select=*');
  const allRoutines = (rows || []).map(r => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    defaultSets: r.default_sets,
    exerciseIds: r.exercise_ids || [],
    isPublic: r.is_public,
    authorName: r.author_name
  }));

  const userRoutines = allRoutines.filter(r => r.userId === userId);
  const sharedRoutines = allRoutines.filter(r => r.isPublic && r.userId !== userId);

  return { userRoutines, sharedRoutines };
}

async function syncUserRoutines(userId, routines, authorName) {
  if (!Array.isArray(routines)) return;

  // 1. Delete previous routines of this user
  await apiFetch(`routines?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });

  // 2. Insert updated routines
  const toInsert = routines.map(r => ({
    id: r.id,
    user_id: userId,
    name: r.name,
    description: r.description || '',
    default_sets: r.defaultSets || 3,
    exercise_ids: r.exerciseIds || [],
    is_public: !!r.isPublic,
    author_name: authorName || r.authorName || 'Atleta'
  }));

  if (toInsert.length > 0) {
    await apiFetch('routines', {
      method: 'POST',
      body: JSON.stringify(toInsert)
    });
  }
}

async function cloneRoutine(userId, routineId, authorName) {
  const rows = await apiFetch(`routines?id=eq.${encodeURIComponent(routineId)}&select=*`);
  if (!rows || rows.length === 0) return null;

  const target = rows[0];
  const newId = 'rot_' + Date.now();
  const cloned = {
    id: newId,
    user_id: userId,
    name: `${target.name} (Clonada)`,
    description: target.description || '',
    default_sets: target.default_sets || 3,
    exercise_ids: target.exercise_ids || [],
    is_public: false,
    author_name: authorName || 'Atleta'
  };

  await apiFetch('routines', {
    method: 'POST',
    body: JSON.stringify(cloned)
  });

  return {
    id: cloned.id,
    userId: cloned.user_id,
    name: cloned.name,
    description: cloned.description,
    defaultSets: cloned.default_sets,
    exerciseIds: cloned.exercise_ids,
    isPublic: cloned.is_public,
    authorName: cloned.author_name
  };
}

// -------------------------------------------------------------
// HISTORY
// -------------------------------------------------------------

async function getHistoryForUser(userId) {
  if (!userId) return [];
  const rows = await apiFetch(`history?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.asc`);
  return (rows || []).map(r => ({
    id: r.id,
    userId: r.user_id,
    routineId: r.routine_id,
    routineName: r.routine_name,
    date: r.date,
    durationSeconds: r.duration_seconds,
    exercises: r.exercises || []
  }));
}

async function syncUserHistory(userId, historyList) {
  if (!Array.isArray(historyList)) return;

  // 1. Delete previous history of this user
  await apiFetch(`history?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });

  // 2. Insert updated history
  const toInsert = historyList.map(h => ({
    id: h.id || ('hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    user_id: userId,
    routine_id: h.routineId || null,
    routine_name: h.routineName || 'Treino',
    date: h.date,
    duration_seconds: h.durationSeconds || 0,
    exercises: h.exercises || []
  }));

  if (toInsert.length > 0) {
    await apiFetch('history', {
      method: 'POST',
      body: JSON.stringify(toInsert)
    });
  }
}

module.exports = {
  getProfileByEmail,
  getProfileById,
  createProfile,
  updateProfile,
  createSession,
  getSessionUserId,
  deleteSession,
  getExercisesForUser,
  syncUserExercises,
  getRoutinesForUser,
  syncUserRoutines,
  cloneRoutine,
  getHistoryForUser,
  syncUserHistory
};
