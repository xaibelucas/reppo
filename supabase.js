// Supabase Client Adapter for Reppo
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

function toUserProfile(row) {
  const metaObj = (row.weight_history || []).find(item => item && item._meta) || {};
  const cleanWeightHistory = (row.weight_history || []).filter(item => item && !item._meta);

  const cleanHandle = row.username || metaObj.username || (row.name ? row.name.toLowerCase().replace(/[^a-z0-9]/g, '') : 'atleta');

  return {
    id: row.id,
    name: row.name,
    username: cleanHandle,
    email: row.email,
    passwordHash: row.password_hash,
    salt: row.salt,
    profile: {
      currentWeight: row.current_weight !== null ? parseFloat(row.current_weight) : null,
      height: row.height !== null ? parseFloat(row.height) : null,
      goal: row.goal || 'Hipertrofia',
      experienceLevel: row.experience_level || 'Intermediário',
      weightHistory: cleanWeightHistory,
      avatarUrl: row.avatar_url || metaObj.avatarUrl || null,
      bio: row.bio || metaObj.bio || '',
      following: Array.isArray(row.following) ? row.following : (metaObj.following || [])
    }
  };
}

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
  const defaultUsername = userData.username || (userData.name ? userData.name.toLowerCase().replace(/[^a-z0-9]/g, '') : 'atleta');
  const metaObj = {
    _meta: true,
    username: defaultUsername,
    bio: userData.profile?.bio || '',
    avatarUrl: userData.profile?.avatarUrl || null,
    following: []
  };

  const payload = {
    id: userData.id || ('usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
    name: userData.name,
    email: userData.email.trim().toLowerCase(),
    password_hash: userData.passwordHash,
    salt: userData.salt,
    current_weight: userData.profile?.currentWeight || null,
    height: userData.profile?.height || null,
    goal: userData.profile?.goal || 'Hipertrofia',
    experience_level: userData.profile?.experienceLevel || 'Intermediário',
    weight_history: [metaObj]
  };

  const rows = await apiFetch('profiles', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });

  return rows && rows[0] ? toUserProfile(rows[0]) : null;
}

async function updateProfile(id, updates) {
  const existing = await getProfileById(id);
  const existingMeta = (existing && existing.profile) ? {
    username: existing.username,
    bio: existing.profile.bio,
    avatarUrl: existing.profile.avatarUrl,
    following: existing.profile.following
  } : {};

  const updatedMeta = {
    _meta: true,
    username: updates.username !== undefined ? updates.username.toLowerCase().replace(/[^a-z0-9_]/g, '') : (existingMeta.username || 'atleta'),
    bio: updates.bio !== undefined ? updates.bio : (existingMeta.bio || ''),
    avatarUrl: updates.avatarUrl !== undefined ? updates.avatarUrl : (existingMeta.avatarUrl || null),
    following: updates.following !== undefined ? updates.following : (existingMeta.following || [])
  };

  const cleanWeights = updates.weightHistory || (existing && existing.profile ? existing.profile.weightHistory : []) || [];
  const mergedHistory = [...cleanWeights.filter(w => !w._meta), updatedMeta];

  const payload = {
    weight_history: mergedHistory
  };

  if (updates.name) payload.name = updates.name.trim();
  if (updates.goal) payload.goal = updates.goal;
  if (updates.height !== undefined) payload.height = updates.height;
  if (updates.experienceLevel) payload.experience_level = updates.experienceLevel;
  if (updates.currentWeight !== undefined) payload.current_weight = updates.currentWeight;

  const rows = await apiFetch(`profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });

  return rows && rows[0] ? toUserProfile(rows[0]) : null;
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
// SOCIAL: SEARCH & FOLLOWS
// -------------------------------------------------------------

async function searchUsers(rawQuery, currentUserId) {
  const q = (rawQuery || '').replace(/^@+/, '').trim().toLowerCase();
  if (!q) return [];

  const rows = await apiFetch('profiles?select=*&limit=50');
  const me = await getProfileById(currentUserId);
  const myFollowing = me?.profile?.following || [];

  const results = [];
  for (const row of rows || []) {
    if (row.id === currentUserId) continue;
    const user = toUserProfile(row);
    const matchesName = (user.name || '').toLowerCase().includes(q);
    const matchesHandle = (user.username || '').toLowerCase().includes(q);

    if (matchesName || matchesHandle) {
      results.push({
        id: user.id,
        name: user.name,
        username: user.username,
        avatarUrl: user.profile.avatarUrl,
        bio: user.profile.bio,
        isFollowing: myFollowing.includes(user.id)
      });
    }
  }

  return results.slice(0, 10);
}

async function toggleFollow(followerId, targetUserId) {
  const me = await getProfileById(followerId);
  if (!me) throw new Error('Usuário não encontrado');

  const currentFollowing = me.profile.following || [];
  let isFollowing = false;
  let updatedFollowing = [];

  if (currentFollowing.includes(targetUserId)) {
    updatedFollowing = currentFollowing.filter(id => id !== targetUserId);
    isFollowing = false;
  } else {
    updatedFollowing = [...currentFollowing, targetUserId];
    isFollowing = true;
  }

  await updateProfile(followerId, { following: updatedFollowing });

  return { isFollowing, following: updatedFollowing };
}

// -------------------------------------------------------------
// SOCIAL: FEED & LIKES
// -------------------------------------------------------------

async function getFeedForUser(userId) {
  const me = await getProfileById(userId);
  if (!me) return [];

  const following = me.profile.following || [];
  if (following.length === 0) return [];

  // Fetch all history from followed users
  const rows = await apiFetch('history?select=*&order=created_at.desc&limit=100');
  const followedHistory = (rows || []).filter(h => following.includes(h.user_id));

  // Map author info & likes
  const profilesCache = {};
  const feedItems = [];

  for (const h of followedHistory) {
    if (!profilesCache[h.user_id]) {
      profilesCache[h.user_id] = await getProfileById(h.user_id);
    }
    const author = profilesCache[h.user_id];
    if (!author) continue;

    const rawExercises = h.exercises || [];
    const metaObj = rawExercises.find(e => e && e._meta) || {};
    const cleanExercises = rawExercises.filter(e => !e._meta);
    const likes = metaObj.likes || [];

    feedItems.push({
      id: h.id,
      userId: h.user_id,
      authorName: author.name,
      authorUsername: author.username,
      authorAvatarUrl: author.profile?.avatarUrl || null,
      authorBio: author.profile?.bio || '',
      routineName: h.routine_name || 'Treino',
      date: h.date,
      durationSeconds: h.duration_seconds || 0,
      exercises: cleanExercises,
      likes: likes,
      likesCount: likes.length,
      isLiked: likes.includes(userId)
    });
  }

  // Sort newest first
  feedItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return feedItems;
}

async function toggleLikeWorkout(userId, workoutId) {
  const rows = await apiFetch(`history?id=eq.${encodeURIComponent(workoutId)}&select=id,exercises`);
  if (!rows || rows.length === 0) throw new Error('Treino não encontrado');

  const h = rows[0];
  const rawExercises = h.exercises || [];
  let metaObj = rawExercises.find(e => e && e._meta);

  if (!metaObj) {
    metaObj = { _meta: true, likes: [] };
    rawExercises.push(metaObj);
  }

  metaObj.likes = Array.isArray(metaObj.likes) ? metaObj.likes : [];
  let isLiked = false;

  if (metaObj.likes.includes(userId)) {
    metaObj.likes = metaObj.likes.filter(id => id !== userId);
    isLiked = false;
  } else {
    metaObj.likes.push(userId);
    isLiked = true;
  }

  await apiFetch(`history?id=eq.${encodeURIComponent(workoutId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ exercises: rawExercises })
  });

  return { isLiked, likesCount: metaObj.likes.length };
}

// -------------------------------------------------------------
// EXERCISES
// -------------------------------------------------------------

async function getExercisesForUser(userId) {
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

  await apiFetch(`exercises?user_id=eq.${encodeURIComponent(userId)}&is_base=eq.false`, {
    method: 'DELETE'
  });

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

  await apiFetch(`routines?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });

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
  return (rows || []).map(r => {
    const rawExercises = r.exercises || [];
    const cleanExercises = rawExercises.filter(e => !e._meta);
    return {
      id: r.id,
      userId: r.user_id,
      routineId: r.routine_id,
      routineName: r.routine_name,
      date: r.date,
      durationSeconds: r.duration_seconds,
      exercises: cleanExercises
    };
  });
}

async function syncUserHistory(userId, historyList) {
  if (!Array.isArray(historyList)) return;

  // Preserve existing _meta with likes if already present
  const existingRows = await apiFetch(`history?user_id=eq.${encodeURIComponent(userId)}&select=id,exercises`);
  const likesMap = {};
  for (const row of existingRows || []) {
    const m = (row.exercises || []).find(e => e && e._meta);
    if (m && m.likes) likesMap[row.id] = m.likes;
  }

  await apiFetch(`history?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });

  const toInsert = historyList.map(h => {
    const cleanExercises = (h.exercises || []).filter(e => !e._meta);
    const existingLikes = likesMap[h.id] || [];
    cleanExercises.push({ _meta: true, likes: existingLikes });

    return {
      id: h.id || ('hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
      user_id: userId,
      routine_id: h.routineId || null,
      routine_name: h.routineName || 'Treino',
      date: h.date,
      duration_seconds: h.durationSeconds || 0,
      exercises: cleanExercises
    };
  });

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
  searchUsers,
  toggleFollow,
  getFeedForUser,
  toggleLikeWorkout,
  getExercisesForUser,
  syncUserExercises,
  getRoutinesForUser,
  syncUserRoutines,
  cloneRoutine,
  getHistoryForUser,
  syncUserHistory
};
