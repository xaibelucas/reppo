// Vercel Serverless Function Handler for Reppo API
const db = require('../supabase');
const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const hashed = crypto.scryptSync(password, salt, 64).toString('hex');
  return hashed === hash;
}

async function getAuthenticatedUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const userId = await db.getSessionUserId(token);
  if (!userId) return null;
  return await db.getProfileById(userId);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  // Resolve pathname supporting both local server and Vercel serverless rewrites
  let pathname = reqUrl.pathname;
  const pathParam = reqUrl.searchParams.get('path');
  if (pathParam) {
    pathname = '/api/' + pathParam.replace(/^\/+/, '');
  } else if (req.headers['x-matched-path']) {
    pathname = req.headers['x-matched-path'];
  }

  // 1. REGISTER
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const { name, email, password, username, bio } = await parseJsonBody(req);
      if (!name || !email || !password) {
        return sendJson(res, 400, { error: 'Nome, e-mail e senha são obrigatórios.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existing = await db.getProfileByEmail(normalizedEmail);
      if (existing) {
        return sendJson(res, 409, { error: 'Já existe uma conta cadastrada com este e-mail.' });
      }

      const { hash, salt } = hashPassword(password);
      const userId = 'usr_' + Date.now();
      const cleanUsername = username ? username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

      const newUser = await db.createProfile({
        id: userId,
        name: name.trim(),
        username: cleanUsername,
        email: normalizedEmail,
        passwordHash: hash,
        salt,
        profile: {
          currentWeight: null,
          height: null,
          goal: 'Hipertrofia',
          experienceLevel: 'Intermediário',
          weightHistory: [],
          bio: bio || '',
          avatarUrl: null,
          following: []
        }
      });

      const token = crypto.randomBytes(32).toString('hex');
      await db.createSession(token, userId);

      const safeUser = {
        id: newUser.id,
        name: newUser.name,
        username: newUser.username,
        email: newUser.email,
        profile: newUser.profile
      };

      return sendJson(res, 201, { token, user: safeUser, message: 'Conta criada com sucesso!' });
    } catch (e) {
      console.error('Erro no registro:', e);
      return sendJson(res, 500, { error: 'Erro ao criar conta.' });
    }
  }

  // 2. LOGIN
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, password } = await parseJsonBody(req);
      if (!email || !password) {
        return sendJson(res, 400, { error: 'E-mail e senha são obrigatórios.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await db.getProfileByEmail(normalizedEmail);

      if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
        return sendJson(res, 401, { error: 'E-mail ou senha incorretos.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      await db.createSession(token, user.id);

      const safeUser = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        profile: user.profile
      };

      return sendJson(res, 200, { token, user: safeUser, message: 'Login realizado com sucesso!' });
    } catch (e) {
      console.error('Erro no login:', e);
      return sendJson(res, 500, { error: 'Erro ao fazer login.' });
    }
  }

  // 3. LOGOUT
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      await db.deleteSession(token);
    }
    return sendJson(res, 200, { success: true, message: 'Sessão encerrada com sucesso.' });
  }

  // 4. GET ME
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Sessão expirada ou inválida.' });

    return sendJson(res, 200, {
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        profile: user.profile
      }
    });
  }

  // 5. UPDATE USER PROFILE
  if (pathname === '/api/user/profile' && req.method === 'PUT') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const updates = await parseJsonBody(req);
      const profileUpdates = {};
      if (updates.name) profileUpdates.name = updates.name.trim();
      if (updates.username) profileUpdates.username = updates.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (updates.bio !== undefined) profileUpdates.bio = updates.bio;
      if (updates.avatarUrl !== undefined) profileUpdates.avatarUrl = updates.avatarUrl;
      if (updates.goal) profileUpdates.goal = updates.goal;
      if (updates.height) profileUpdates.height = parseFloat(updates.height);
      if (updates.experienceLevel) profileUpdates.experienceLevel = updates.experienceLevel;

      if (updates.newWeight) {
        const wNum = parseFloat(updates.newWeight);
        if (wNum > 0) {
          profileUpdates.currentWeight = wNum;
          const history = [...(user.profile.weightHistory || [])];
          history.push({ date: new Date().toISOString(), weight: wNum });
          profileUpdates.weightHistory = history;
        }
      }

      const updated = await db.updateProfile(user.id, profileUpdates);
      return sendJson(res, 200, {
        success: true,
        user: {
          id: updated.id,
          name: updated.name,
          username: updated.username,
          email: updated.email,
          profile: updated.profile
        }
      });
    } catch (e) {
      console.error('Erro ao atualizar perfil:', e);
      return sendJson(res, 500, { error: 'Erro ao atualizar dados.' });
    }
  }

  // 6. GET DATA
  if (pathname === '/api/data' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    const userId = user ? user.id : null;

    const [exercises, routinesData, history] = await Promise.all([
      db.getExercisesForUser(userId),
      db.getRoutinesForUser(userId),
      db.getHistoryForUser(userId)
    ]);

    return sendJson(res, 200, {
      user: user ? {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        profile: user.profile
      } : null,
      exercises,
      routines: routinesData.userRoutines,
      sharedRoutines: routinesData.sharedRoutines,
      history
    });
  }

  // 7. SAVE USER DATA
  if (pathname === '/api/save' && req.method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const payload = await parseJsonBody(req);

      const promises = [];
      if (Array.isArray(payload.exercises)) {
        promises.push(db.syncUserExercises(user.id, payload.exercises));
      }
      if (Array.isArray(payload.routines)) {
        promises.push(db.syncUserRoutines(user.id, payload.routines, user.name));
      }
      if (Array.isArray(payload.history)) {
        promises.push(db.syncUserHistory(user.id, payload.history));
      }

      await Promise.all(promises);
      return sendJson(res, 200, { success: true });
    } catch (err) {
      console.error('Erro ao salvar dados do usuário:', err);
      return sendJson(res, 400, { error: 'Dados inválidos.' });
    }
  }

  // 8. CLONE ROUTINE
  if (pathname === '/api/routines/clone' && req.method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const { routineId } = await parseJsonBody(req);
      const cloned = await db.cloneRoutine(user.id, routineId, user.name);
      if (!cloned) return sendJson(res, 404, { error: 'Rotina não encontrada.' });

      return sendJson(res, 201, { success: true, routine: cloned, message: 'Rotina clonada com sucesso para sua conta!' });
    } catch (e) {
      return sendJson(res, 500, { error: 'Erro ao clonar rotina.' });
    }
  }

  // 9. SOCIAL: SEARCH USERS
  if (pathname === '/api/users/search' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    const q = reqUrl.searchParams.get('q') || '';
    try {
      const results = await db.searchUsers(q, user.id);
      return sendJson(res, 200, { users: results });
    } catch (e) {
      return sendJson(res, 500, { error: 'Erro na busca de usuários.' });
    }
  }

  // 10. SOCIAL: TOGGLE FOLLOW
  if (pathname === '/api/users/follow' && req.method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const { targetUserId } = await parseJsonBody(req);
      if (!targetUserId) return sendJson(res, 400, { error: 'ID do usuário obrigatório.' });

      const result = await db.toggleFollow(user.id, targetUserId);
      return sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      return sendJson(res, 500, { error: 'Erro ao seguir/deixar de seguir.' });
    }
  }

  // 11. SOCIAL: GET FEED (WORKOUTS FROM FOLLOWED USERS)
  if (pathname === '/api/feed' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const feed = await db.getFeedForUser(user.id);
      return sendJson(res, 200, { feed });
    } catch (e) {
      console.error('Erro ao buscar feed:', e);
      return sendJson(res, 500, { error: 'Erro ao carregar feed.' });
    }
  }

  // 12. SOCIAL: TOGGLE LIKE WORKOUT
  if (pathname === '/api/history/like' && req.method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const { workoutId } = await parseJsonBody(req);
      if (!workoutId) return sendJson(res, 400, { error: 'ID do treino obrigatório.' });

      const result = await db.toggleLikeWorkout(user.id, workoutId);
      return sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      return sendJson(res, 500, { error: 'Erro ao curtir treino.' });
    }
  }

  return sendJson(res, 404, { error: 'Rota não encontrada' });
};
