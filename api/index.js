// Vercel Serverless Function Handler for Academia Tracker API
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // 1. REGISTER
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const { name, email, password } = await parseJsonBody(req);
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

      const user = await db.createProfile({
        id: userId,
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hash,
        salt,
        profile: {
          currentWeight: null,
          height: null,
          goal: 'Hipertrofia',
          experienceLevel: 'Intermediário',
          weightHistory: []
        }
      });

      const token = crypto.randomBytes(32).toString('hex');
      await db.createSession(token, userId);

      const safeUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile
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
    return sendJson(res, 200, { success: true });
  }

  // 4. ME
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    return sendJson(res, 200, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile
      }
    });
  }

  // 5. UPDATE PROFILE
  if (pathname === '/api/user/profile' && req.method === 'PUT') {
    const user = await getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const updates = await parseJsonBody(req);
      const profileUpdates = {};
      if (updates.name) profileUpdates.name = updates.name.trim();
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
      return sendJson(res, 200, { success: true, profile: updated.profile, name: updated.name });
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
      exercises,
      routines: routinesData.userRoutines,
      sharedRoutines: routinesData.sharedRoutines,
      history,
      user: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile
      } : null
    });
  }

  // 7. SAVE DATA
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

  return sendJson(res, 404, { error: 'Rota não encontrada' });
};
