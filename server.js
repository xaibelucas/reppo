const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Base catalog exercises given to every new user
const BASE_EXERCISES = [
  { id: "ex_1", name: "Supino Reto Articulado (Máquina)", muscle: "Peito", equipment: "Máquina", machineSettings: "Banco no pino 4, pegada média", notes: "Foco no controle da fase excêntrica", targetRepMin: 8, targetRepMax: 12, isBase: true },
  { id: "ex_2", name: "Crucifixo / Peck Deck (Máquina)", muscle: "Peito", equipment: "Máquina", machineSettings: "Assento no 3, braços na abertura 2", notes: "Segurar 1s no pico de contração", targetRepMin: 10, targetRepMax: 15, isBase: true },
  { id: "ex_3", name: "Puxada Frontal na Polia", muscle: "Costas", equipment: "Polia", machineSettings: "Apoio de perna travado no pino 2", notes: "Puxar em direção ao peito com pegada pronada", targetRepMin: 8, targetRepMax: 12, isBase: true },
  { id: "ex_4", name: "Remada Baixa Triângulo", muscle: "Costas", equipment: "Polia", machineSettings: "Pés firmes na chapa de apoio", notes: "Alongar as escápulas na ida e retrair na volta", targetRepMin: 8, targetRepMax: 12, isBase: true },
  { id: "ex_5", name: "Leg Press 45°", muscle: "Quadríceps", equipment: "Máquina", machineSettings: "Encosto inclinação média", notes: "Pés na largura dos ombros no meio da plataforma", targetRepMin: 8, targetRepMax: 12, isBase: true },
  { id: "ex_6", name: "Cadeira Extensora", muscle: "Quadríceps", equipment: "Máquina", machineSettings: "Encosto pino 3, rolo sobre o tornozelo", notes: "Pausa de 1 segundo no topo", targetRepMin: 10, targetRepMax: 15, isBase: true },
  { id: "ex_7", name: "Mesa Flexora", muscle: "Posterior", equipment: "Máquina", machineSettings: "Rolo logo acima do calcanhar", notes: "Manter quadril colado no banco", targetRepMin: 10, targetRepMax: 15, isBase: true },
  { id: "ex_8", name: "Desenvolvimento Máquina", muscle: "Ombros", equipment: "Máquina", machineSettings: "Banco ajustado na altura dos ombros", notes: "Cotovelos ligeiramente à frente do corpo", targetRepMin: 6, targetRepMax: 10, isBase: true },
  { id: "ex_9", name: "Elevação Lateral na Polia", muscle: "Ombros", equipment: "Polia", machineSettings: "Polia na altura do tornozelo / mão", notes: "Foco no deltóide lateral", targetRepMin: 12, targetRepMax: 15, isBase: true },
  { id: "ex_10", name: "Tríceps Corda na Polia", muscle: "Tríceps", equipment: "Polia", machineSettings: "Polia no topo", notes: "Abrir a corda no final da extensão", targetRepMin: 10, targetRepMax: 15, isBase: true },
  { id: "ex_11", name: "Rosca Direta na Polia", muscle: "Bíceps", equipment: "Polia", machineSettings: "Polia embaixo, barra reta", notes: "Cotovelos fixos ao lado do tronco", targetRepMin: 8, targetRepMax: 12, isBase: true },
  { id: "ex_12", name: "Gêmeos Sentado (Panturrilha)", muscle: "Panturrilha", equipment: "Máquina", machineSettings: "Almofada acima dos joelhos", notes: "Amplitude máxima (alongar embaixo, contrair em cima)", targetRepMin: 12, targetRepMax: 15, isBase: true }
];

// Helper to ensure database structure exists
function getDatabase() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (!data.users) data.users = [];
      if (!data.sessions) data.sessions = {};
      if (!data.exercises) data.exercises = [...BASE_EXERCISES];
      if (!data.routines) data.routines = [];
      if (!data.history) data.history = [];
      return data;
    } catch (e) {
      console.error('Erro ao ler data.json:', e);
    }
  }
  return {
    users: [],
    sessions: {},
    exercises: [...BASE_EXERCISES],
    routines: [],
    history: []
  };
}

function saveDatabase(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Password hashing helpers with salt (Zero external npm packages needed!)
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const hashed = crypto.scryptSync(password, salt, 64).toString('hex');
  return hashed === hash;
}

// Helper to get user from Bearer token
function getAuthenticatedUser(req, db) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const userId = db.sessions[token];
  if (!userId) return null;
  return db.users.find(u => u.id === userId) || null;
}

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
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

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const db = getDatabase();

  // -------------------------------------------------------------
  // AUTH API: REGISTER
  // -------------------------------------------------------------
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const { name, email, password } = await parseJsonBody(req);
      if (!name || !email || !password) {
        return sendJson(res, 400, { error: 'Nome, e-mail e senha são obrigatórios.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (db.users.some(u => u.email === normalizedEmail)) {
        return sendJson(res, 409, { error: 'Já existe uma conta cadastrada com este e-mail.' });
      }

      const { hash, salt } = hashPassword(password);
      const userId = 'usr_' + Date.now();

      const newUser = {
        id: userId,
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hash,
        salt,
        createdAt: new Date().toISOString(),
        profile: {
          currentWeight: null,
          height: null,
          goal: 'Hipertrofia',
          experienceLevel: 'Intermediário',
          weightHistory: []
        }
      };

      db.users.push(newUser);

      // Create permanent session token
      const token = crypto.randomBytes(32).toString('hex');
      db.sessions[token] = userId;
      saveDatabase(db);

      const safeUser = {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        profile: newUser.profile
      };

      return sendJson(res, 201, { token, user: safeUser, message: 'Conta criada com sucesso!' });
    } catch (e) {
      console.error('Erro no registro:', e);
      return sendJson(res, 500, { error: 'Erro ao criar conta.' });
    }
  }

  // -------------------------------------------------------------
  // AUTH API: LOGIN
  // -------------------------------------------------------------
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, password } = await parseJsonBody(req);
      if (!email || !password) {
        return sendJson(res, 400, { error: 'E-mail e senha são obrigatórios.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = db.users.find(u => u.email === normalizedEmail);

      if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
        return sendJson(res, 401, { error: 'E-mail ou senha incorretos.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      db.sessions[token] = user.id;
      saveDatabase(db);

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

  // -------------------------------------------------------------
  // AUTH API: LOGOUT
  // -------------------------------------------------------------
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      delete db.sessions[token];
      saveDatabase(db);
    }
    return sendJson(res, 200, { success: true });
  }

  // -------------------------------------------------------------
  // AUTH API: ME (CURRENT USER PROFILE)
  // -------------------------------------------------------------
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getAuthenticatedUser(req, db);
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

  // -------------------------------------------------------------
  // PROFILE API: UPDATE CHARACTERISTICS & WEIGHT
  // -------------------------------------------------------------
  if (pathname === '/api/user/profile' && req.method === 'PUT') {
    const user = getAuthenticatedUser(req, db);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const updates = await parseJsonBody(req);
      if (updates.name) user.name = updates.name.trim();

      if (!user.profile) user.profile = {};

      if (updates.goal) user.profile.goal = updates.goal;
      if (updates.height) user.profile.height = parseFloat(updates.height);
      if (updates.experienceLevel) user.profile.experienceLevel = updates.experienceLevel;

      // New bodyweight record
      if (updates.newWeight) {
        const wNum = parseFloat(updates.newWeight);
        if (wNum > 0) {
          user.profile.currentWeight = wNum;
          if (!user.profile.weightHistory) user.profile.weightHistory = [];
          user.profile.weightHistory.push({
            date: new Date().toISOString(),
            weight: wNum
          });
        }
      }

      saveDatabase(db);
      return sendJson(res, 200, { success: true, profile: user.profile, name: user.name });
    } catch (e) {
      console.error('Erro ao atualizar perfil:', e);
      return sendJson(res, 500, { error: 'Erro ao atualizar dados.' });
    }
  }

  // -------------------------------------------------------------
  // DATA API: GET USER DATA (Scoped to User + Shared Routines)
  // -------------------------------------------------------------
  if (pathname === '/api/data' && req.method === 'GET') {
    const user = getAuthenticatedUser(req, db);
    if (!user) {
      return sendJson(res, 200, {
        exercises: (db.exercises || []).filter(e => e.isBase || !e.userId),
        routines: [],
        sharedRoutines: [],
        history: []
      });
    }

    // Exercises: Base catalog (or unassigned exercises) + user's custom exercises
    const userExercises = (db.exercises || []).filter(e => e.isBase || !e.userId || e.userId === user.id);

    // Routines: User's private routines
    const userRoutines = (db.routines || []).filter(r => r.userId === user.id);

    // Shared Routines from other users
    const sharedRoutines = (db.routines || []).filter(r => r.isPublic && r.userId !== user.id).map(r => {
      const author = db.users.find(u => u.id === r.userId);
      return {
        ...r,
        authorName: author ? author.name : 'Outro Atleta'
      };
    });

    // History: strictly user's own workouts
    const userHistory = (db.history || []).filter(h => h.userId === user.id);

    return sendJson(res, 200, {
      exercises: userExercises,
      routines: userRoutines,
      sharedRoutines,
      history: userHistory,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile
      }
    });
  }

  // -------------------------------------------------------------
  // DATA API: SAVE USER DATA
  // -------------------------------------------------------------
  if (pathname === '/api/save' && req.method === 'POST') {
    const user = getAuthenticatedUser(req, db);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const payload = await parseJsonBody(req);

      // Save user custom exercises (keeping base exercises clean)
      if (Array.isArray(payload.exercises)) {
        // Keep exercises from other users & base
        const otherExercises = (db.exercises || []).filter(e => e.isBase || e.userId !== user.id);
        const myCustomExercises = payload.exercises.filter(e => !e.isBase).map(e => ({
          ...e,
          userId: user.id
        }));
        db.exercises = [...otherExercises, ...myCustomExercises];
      }

      // Save user routines
      if (Array.isArray(payload.routines)) {
        const otherRoutines = (db.routines || []).filter(r => r.userId !== user.id);
        const myRoutines = payload.routines.map(r => ({
          ...r,
          userId: user.id,
          isPublic: !!r.isPublic
        }));
        db.routines = [...otherRoutines, ...myRoutines];
      }

      // Save user workout history
      if (Array.isArray(payload.history)) {
        const otherHistory = (db.history || []).filter(h => h.userId !== user.id);
        const myHistory = payload.history.map(h => ({
          ...h,
          userId: user.id
        }));
        db.history = [...otherHistory, ...myHistory];
      }

      saveDatabase(db);
      return sendJson(res, 200, { success: true });
    } catch (err) {
      console.error('Erro ao salvar dados do usuário:', err);
      return sendJson(res, 400, { error: 'Dados inválidos.' });
    }
  }

  // -------------------------------------------------------------
  // DATA API: CLONE SHARED ROUTINE
  // -------------------------------------------------------------
  if (pathname === '/api/routines/clone' && req.method === 'POST') {
    const user = getAuthenticatedUser(req, db);
    if (!user) return sendJson(res, 401, { error: 'Não autenticado.' });

    try {
      const { routineId } = await parseJsonBody(req);
      const targetRoutine = (db.routines || []).find(r => r.id === routineId);

      if (!targetRoutine) {
        return sendJson(res, 404, { error: 'Rotina não encontrada.' });
      }

      const clonedRoutine = {
        id: 'rot_' + Date.now(),
        userId: user.id,
        name: `${targetRoutine.name} (Clonada)`,
        description: targetRoutine.description || '',
        exerciseIds: [...(targetRoutine.exerciseIds || [])],
        defaultSets: targetRoutine.defaultSets || 3,
        isPublic: false
      };

      db.routines.push(clonedRoutine);
      saveDatabase(db);

      return sendJson(res, 201, { success: true, routine: clonedRoutine, message: 'Rotina clonada com sucesso para sua conta!' });
    } catch (e) {
      return sendJson(res, 500, { error: 'Erro ao clonar rotina.' });
    }
  }

  // -------------------------------------------------------------
  // STATIC FILE SERVING
  // -------------------------------------------------------------
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Acesso negado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Arquivo não encontrado');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`Academia Tracker - Servidor rodando em:`);
  console.log(`http://localhost:${PORT}`);
  console.log(`===============================================`);
});
