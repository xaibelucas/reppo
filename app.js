// Academia Tracker - Core Application Logic (Auth, Profiles, PSE & Sobrecarga)
// ==============================================================================

const TOKEN_KEY = 'gym_auth_token_v1';
const ACTIVE_WORKOUT_KEY = 'academia_tracker_active_session_v1';

// Global App State
let authToken = localStorage.getItem(TOKEN_KEY) || null;
let currentUser = null;

let appData = {
  exercises: [],
  routines: [],
  sharedRoutines: [],
  history: []
};

let currentRoutineSubTab = 'mine';
let activeWorkout = null;
let activeWorkoutTimerInterval = null;

// Screen Wake Lock State (Keeps mobile screen on during workout)
let wakeLockSentinel = null;
let isWakeLockEnabled = false;

// Active Charts instances (Chart.js)
let modalChartInstance = null;
let historyChartInstance = null;

// Rest Timer State
let restTimerState = {
  totalSeconds: 90,
  remainingSeconds: 90,
  interval: null,
  isRunning: false
};

// Web Audio Beep for Rest Timer (Sound only, no vibration)
let audioCtx = null;
function playTimerBeep() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 tone
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {
    console.log('Audio notification error:', e);
  }
}

// -------------------------------------------------------------
// INITIALIZATION & AUTHENTICATION FLOW
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  initLucide();
  initServiceWorker();

  if (authToken) {
    const verified = await verifySession();
    if (verified) {
      showAppContainer();
      restoreActiveWorkout();
      switchTab('workout');
      await loadUserData();
      checkProfilePromptBanner();
    } else {
      showAuthScreen();
    }
  } else {
    showAuthScreen();
  }
});

function initLucide() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

function initServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('Service Worker PWA ativo.'))
      .catch(err => console.warn('Service Worker erro:', err));
  }
}

function showAuthScreen() {
  document.getElementById('authView')?.classList.remove('hidden');
  document.getElementById('appContainer')?.classList.add('hidden');
  initLucide();
}

function showAppContainer() {
  document.getElementById('authView')?.classList.add('hidden');
  document.getElementById('appContainer')?.classList.remove('hidden');
  initLucide();
}

function switchAuthTab(tab) {
  const loginBtn = document.getElementById('authTabLoginBtn');
  const regBtn = document.getElementById('authTabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');

  if (tab === 'login') {
    loginBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-zinc-800 text-white shadow-sm';
    regBtn.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-zinc-400 hover:text-white';
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
  } else {
    regBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-zinc-800 text-white shadow-sm';
    loginBtn.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-zinc-400 hover:text-white';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
  initLucide();
}

async function verifySession() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.user) {
        currentUser = data.user;
        updateUserUIHeader();
        return true;
      }
    }
  } catch (e) {
    console.warn('Erro ao verificar sessão:', e);
  }
  localStorage.removeItem(TOKEN_KEY);
  authToken = null;
  currentUser = null;
  return false;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmailInput').value.trim();
  const password = document.getElementById('loginPasswordInput').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao fazer login.', 'warning');
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, authToken);

    showToast(`Bem-vindo de volta, ${currentUser.name}!`);
    showAppContainer();
    updateUserUIHeader();
    switchTab('workout');
    await loadUserData();
    checkProfilePromptBanner();
  } catch (err) {
    showToast('Erro de conexão com o servidor.', 'danger');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('regNameInput').value.trim();
  const email = document.getElementById('regEmailInput').value.trim();
  const password = document.getElementById('regPasswordInput').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao criar conta.', 'warning');
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, authToken);

    showToast(`Conta criada com sucesso! Bem-vindo, ${currentUser.name}!`);
    showAppContainer();
    updateUserUIHeader();
    switchTab('workout');
    await loadUserData();
    openOnboardingModal(currentUser.name);
  } catch (err) {
    showToast('Erro de conexão ao criar conta.', 'danger');
  }
}

// -------------------------------------------------------------
// ONBOARDING MODAL (PÓS-CADASTRO)
// -------------------------------------------------------------

function openOnboardingModal(userName) {
  const modal = document.getElementById('onboardingModal');
  const title = document.getElementById('onboardingWelcomeTitle');
  if (title && userName) {
    title.innerText = `Bem-vindo(a), ${userName.split(' ')[0]}!`;
  }
  if (modal) {
    modal.classList.remove('hidden');
    initLucide();
  }
}

function closeOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  if (modal) modal.classList.add('hidden');
}

function skipOnboardingModal() {
  closeOnboardingModal();
  checkProfilePromptBanner();
  showToast('Você pode preencher suas características a qualquer momento no perfil!', 'warning');
}

async function handleOnboardingSubmit(e) {
  e.preventDefault();
  const weight = parseFloat(document.getElementById('onboardWeightInput')?.value) || null;
  const height = parseInt(document.getElementById('onboardHeightInput')?.value, 10) || null;
  const goal = document.getElementById('onboardGoalInput')?.value || 'Hipertrofia';
  const level = document.getElementById('onboardLevelInput')?.value || 'Intermediário';

  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        newWeight: weight,
        height,
        goal,
        experienceLevel: level
      })
    });

    const data = await res.json();
    if (res.ok) {
      if (currentUser) {
        currentUser.profile = data.profile;
      }
      closeOnboardingModal();
      updateUserUIHeader();
      checkProfilePromptBanner();
      showToast('Perfil calibrado com sucesso! Bom treino!');
    } else {
      showToast(data.error || 'Erro ao salvar perfil.', 'warning');
    }
  } catch (err) {
    showToast('Erro de conexão ao salvar características.', 'danger');
  }
}

// -------------------------------------------------------------
// PROFILE PROMPT BANNER (PÓS-CADASTRO)
// -------------------------------------------------------------

function checkProfilePromptBanner() {
  const banner = document.getElementById('profilePromptBanner');
  if (!banner || !currentUser) return;

  const isDismissed = localStorage.getItem('gym_profile_prompt_dismissed_' + currentUser.id);
  const isIncomplete = !currentUser.profile?.currentWeight || !currentUser.profile?.height;

  if (isIncomplete && !isDismissed) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  initLucide();
}

function openProfileToComplete() {
  openProfileDrawer();
  const form = document.getElementById('editProfileForm');
  const info = document.getElementById('profileDisplayInfo');
  if (form) form.classList.remove('hidden');
  if (info) info.classList.add('hidden');
  setTimeout(() => {
    document.getElementById('editHeightInput')?.focus();
  }, 300);
}

function dismissProfileBanner() {
  if (currentUser) {
    localStorage.setItem('gym_profile_prompt_dismissed_' + currentUser.id, 'true');
  }
  document.getElementById('profilePromptBanner')?.classList.add('hidden');
}

async function handleLogout() {
  if (!confirm('Deseja realmente sair da sua conta?')) return;

  if (authToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (e) {}
  }

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACTIVE_WORKOUT_KEY);
  authToken = null;
  currentUser = null;
  activeWorkout = null;
  closeProfileDrawer();
  showAuthScreen();
  showToast('Você saiu da sua conta.');
}

function updateUserUIHeader() {
  if (!currentUser) return;
  const initials = getInitials(currentUser.name);
  const avatarUrl = currentUser.profile?.avatarUrl;

  // Header Avatar & Initials
  const headerAvatarImg = document.getElementById('headerUserAvatarImg');
  const headerInitials = document.getElementById('headerUserInitials');
  const headerName = document.getElementById('headerUserName');

  if (avatarUrl && headerAvatarImg) {
    headerAvatarImg.src = avatarUrl;
    headerAvatarImg.classList.remove('hidden');
    if (headerInitials) headerInitials.classList.add('hidden');
  } else {
    if (headerAvatarImg) headerAvatarImg.classList.add('hidden');
    if (headerInitials) {
      headerInitials.innerText = initials;
      headerInitials.classList.remove('hidden');
    }
  }
  if (headerName) headerName.innerText = currentUser.name.split(' ')[0];

  // Drawer Profile info
  const drawerAvatarImg = document.getElementById('drawerAvatarImg');
  const drawerAvatarInitials = document.getElementById('drawerAvatarInitials');
  const drawerName = document.getElementById('drawerUserName');
  const drawerHandle = document.getElementById('drawerUserHandle');
  const drawerEmail = document.getElementById('drawerUserEmail');

  if (avatarUrl && drawerAvatarImg) {
    drawerAvatarImg.src = avatarUrl;
    drawerAvatarImg.classList.remove('hidden');
    if (drawerAvatarInitials) drawerAvatarInitials.classList.add('hidden');
  } else {
    if (drawerAvatarImg) drawerAvatarImg.classList.add('hidden');
    if (drawerAvatarInitials) {
      drawerAvatarInitials.innerText = initials;
      drawerAvatarInitials.classList.remove('hidden');
    }
  }

  if (drawerName) drawerName.innerText = currentUser.name;
  if (drawerHandle) {
    const handle = currentUser.username || currentUser.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    drawerHandle.innerText = `@${handle}`;
  }
  if (drawerEmail) drawerEmail.innerText = currentUser.email;

  updateProfileCharacteristicsDisplay();
  initLucide();
}

async function handleProfilePhotoUpload(e) {
  const file = e.target?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Por favor, selecione um arquivo de imagem válido.', 'warning');
    return;
  }

  try {
    showToast('Processando foto de perfil...');
    const reader = new FileReader();
    reader.onload = function(evt) {
      const img = new Image();
      img.onload = async function() {
        // Resize and center-crop to square 256x256
        const canvas = document.createElement('canvas');
        const targetSize = 256;
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');

        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
        const base64Data = canvas.toDataURL('image/jpeg', 0.85);

        try {
          const res = await fetch('/api/user/profile', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ avatarUrl: base64Data })
          });

          const data = await res.json();
          if (res.ok) {
            if (data.user) {
              currentUser = data.user;
            } else if (currentUser.profile) {
              currentUser.profile.avatarUrl = base64Data;
            }
            updateUserUIHeader();
            showToast('Foto de perfil atualizada com sucesso!');
          } else {
            showToast(data.error || 'Erro ao salvar foto de perfil.', 'warning');
          }
        } catch (err) {
          console.error('Erro ao enviar avatar:', err);
          showToast('Erro de conexão ao salvar foto de perfil.', 'danger');
        }
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error('Erro ao ler imagem:', err);
    showToast('Erro ao carregar arquivo de imagem.', 'danger');
  }
}

function getInitials(name) {
  if (!name) return 'AT';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// -------------------------------------------------------------
// USER PROFILE SLIDE-OVER DRAWER LOGIC
// -------------------------------------------------------------

function openProfileDrawer() {
  document.getElementById('profileDrawerOverlay')?.classList.remove('hidden');
  document.getElementById('profileDrawerOverlay')?.classList.add('overlay-open');
  document.getElementById('profileDrawer')?.classList.add('drawer-open');
  updateProfileCharacteristicsDisplay();
  renderDrawerWeightHistory();
  initLucide();
}

function closeProfileDrawer() {
  document.getElementById('profileDrawer')?.classList.remove('drawer-open');
  document.getElementById('profileDrawerOverlay')?.classList.remove('overlay-open');
  setTimeout(() => {
    document.getElementById('profileDrawerOverlay')?.classList.add('hidden');
  }, 250);
}

function toggleProfileDrawer() {
  const drawer = document.getElementById('profileDrawer');
  if (drawer && drawer.classList.contains('drawer-open')) {
    closeProfileDrawer();
  } else {
    openProfileDrawer();
  }
}

function updateProfileCharacteristicsDisplay() {
  if (!currentUser || !currentUser.profile) return;
  const prof = currentUser.profile;

  document.getElementById('drawerWeightVal').innerText = prof.currentWeight ? `${prof.currentWeight} kg` : '-- kg';
  document.getElementById('drawerHeightVal').innerText = prof.height ? `${prof.height} cm` : '-- cm';
  document.getElementById('drawerGoalVal').innerText = prof.goal || 'Hipertrofia';
  document.getElementById('drawerLevelVal').innerText = prof.experienceLevel || 'Intermediário';

  // Biografia
  const bioEl = document.getElementById('drawerUserBio');
  if (bioEl) {
    if (prof.bio && prof.bio.trim()) {
      bioEl.innerText = prof.bio.trim();
      bioEl.classList.remove('italic', 'text-zinc-400');
      bioEl.classList.add('text-zinc-200');
    } else {
      bioEl.innerText = 'Nenhuma biografia adicionada ainda.';
      bioEl.classList.add('italic', 'text-zinc-400');
      bioEl.classList.remove('text-zinc-200');
    }
  }

  // Fill in edit inputs
  const editName = document.getElementById('editNameInput');
  const editUsername = document.getElementById('editUsernameInput');
  const editBio = document.getElementById('editBioInput');
  const editHeight = document.getElementById('editHeightInput');
  const editGoal = document.getElementById('editGoalInput');
  const editLevel = document.getElementById('editLevelInput');

  if (editName) editName.value = currentUser.name || '';
  if (editUsername) editUsername.value = currentUser.username || '';
  if (editBio) editBio.value = prof.bio || '';
  if (editHeight) editHeight.value = prof.height || '';
  if (editGoal) editGoal.value = prof.goal || 'Hipertrofia';
  if (editLevel) editLevel.value = prof.experienceLevel || 'Intermediário';
}

function toggleEditProfileForm() {
  const form = document.getElementById('editProfileForm');
  const info = document.getElementById('profileDisplayInfo');
  if (form.classList.contains('hidden')) {
    form.classList.remove('hidden');
    info.classList.add('hidden');
  } else {
    form.classList.add('hidden');
    info.classList.remove('hidden');
  }
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  const name = document.getElementById('editNameInput').value.trim();
  const username = document.getElementById('editUsernameInput').value.trim();
  const bio = document.getElementById('editBioInput').value.trim();
  const height = document.getElementById('editHeightInput').value;
  const goal = document.getElementById('editGoalInput').value;
  const experienceLevel = document.getElementById('editLevelInput').value;

  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name, username, bio, height, goal, experienceLevel })
    });

    const data = await res.json();
    if (res.ok) {
      if (data.user) {
        currentUser = data.user;
      } else {
        currentUser.name = data.name || name;
        if (!currentUser.profile) currentUser.profile = {};
        currentUser.username = data.username || username;
        currentUser.profile.bio = bio;
        currentUser.profile.height = height ? parseFloat(height) : null;
        currentUser.profile.goal = goal;
        currentUser.profile.experienceLevel = experienceLevel;
      }
      updateUserUIHeader();
      toggleEditProfileForm();
      checkProfilePromptBanner();
      showToast('Perfil atualizado com sucesso!');
    } else {
      showToast(data.error || 'Erro ao atualizar perfil.', 'warning');
    }
  } catch (err) {
    showToast('Erro de conexão ao salvar perfil.', 'danger');
  }
}

async function handleNewWeightLog(e) {
  e.preventDefault();
  const input = document.getElementById('newWeightLogInput');
  const newWeight = parseFloat(input.value);
  if (!newWeight || newWeight <= 0) return;

  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ newWeight })
    });

    const data = await res.json();
    if (res.ok) {
      currentUser.profile = data.profile;
      input.value = '';
      updateProfileCharacteristicsDisplay();
      renderDrawerWeightHistory();
      checkProfilePromptBanner();
      showToast(`Pesagem de ${newWeight} kg registrada!`);
    }
  } catch (err) {
    showToast('Erro ao registrar peso.', 'danger');
  }
}

function renderDrawerWeightHistory() {
  const container = document.getElementById('drawerWeightHistoryList');
  if (!container || !currentUser || !currentUser.profile) return;

  const history = currentUser.profile.weightHistory || [];
  if (history.length === 0) {
    container.innerHTML = `<p class="text-[11px] text-zinc-500 italic">Nenhuma pesagem registrada.</p>`;
    return;
  }

  const reversed = [...history].reverse();
  container.innerHTML = reversed.map((item, idx) => {
    const d = new Date(item.date);
    const dateFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    return `
      <div class="flex items-center justify-between py-1 px-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
        <span class="text-zinc-400 font-mono text-[11px]">${dateFormatted}</span>
        <span class="font-bold text-white">${item.weight} kg</span>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// SKELETON LOADERS (DARK OPAQUE SHIMMER PLACEHOLDERS)
// -------------------------------------------------------------

function getExerciseSkeletonHtml() {
  return `
    <div class="card-opaque rounded-2xl p-4 flex flex-col justify-between border border-zinc-800">
      <div>
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="h-5 w-3/5 skeleton rounded-md"></div>
          <div class="flex gap-1.5">
            <div class="w-6 h-6 skeleton rounded-lg"></div>
            <div class="w-6 h-6 skeleton rounded-lg"></div>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          <div class="h-4 w-16 skeleton rounded-md"></div>
          <div class="h-4 w-20 skeleton rounded-md"></div>
          <div class="h-4 w-24 skeleton rounded-md"></div>
        </div>
        <div class="h-14 w-full skeleton-subtle rounded-xl mb-3"></div>
      </div>
      <div class="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
        <div class="h-3 w-28 skeleton rounded-md"></div>
        <div class="h-3 w-16 skeleton rounded-md"></div>
      </div>
    </div>
  `;
}

function getRoutineSkeletonHtml() {
  return `
    <div class="card-opaque rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-zinc-800">
      <div>
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="space-y-1.5 flex-1">
            <div class="h-5 w-2/3 skeleton rounded-md"></div>
            <div class="h-3 w-1/3 skeleton-subtle rounded-md"></div>
          </div>
          <div class="w-8 h-8 skeleton rounded-lg"></div>
        </div>
        <div class="h-3.5 w-4/5 skeleton-subtle rounded-md mb-4"></div>
        <div class="space-y-2 mb-4">
          <div class="h-8 w-full skeleton-subtle rounded-xl"></div>
          <div class="h-8 w-full skeleton-subtle rounded-xl"></div>
          <div class="h-8 w-full skeleton-subtle rounded-xl"></div>
        </div>
      </div>
      <div class="pt-3 border-t border-zinc-800 flex items-center justify-between">
        <div class="h-4 w-20 skeleton rounded-md"></div>
        <div class="h-8 w-24 skeleton rounded-xl"></div>
      </div>
    </div>
  `;
}

function getHistorySkeletonHtml() {
  return `
    <div class="card-opaque rounded-2xl p-4 sm:p-5 border border-zinc-800">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div class="space-y-2">
          <div class="h-5 w-44 skeleton rounded-md"></div>
          <div class="flex gap-2">
            <div class="h-3.5 w-24 skeleton-subtle rounded-md"></div>
            <div class="h-3.5 w-20 skeleton-subtle rounded-md"></div>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="h-8 w-16 skeleton rounded-xl"></div>
          <div class="h-8 w-20 skeleton rounded-xl"></div>
        </div>
      </div>
      <div class="mt-3 space-y-2">
        <div class="h-10 w-full skeleton-subtle rounded-xl"></div>
        <div class="h-10 w-full skeleton-subtle rounded-xl"></div>
      </div>
    </div>
  `;
}

function renderAllSkeletons() {
  const exercisesGrid = document.getElementById('exercisesCatalogGrid');
  if (exercisesGrid) {
    exercisesGrid.innerHTML = Array(6).fill(getExerciseSkeletonHtml()).join('');
  }

  const routinesGrid = document.getElementById('routinesListGrid');
  if (routinesGrid) {
    routinesGrid.innerHTML = Array(4).fill(getRoutineSkeletonHtml()).join('');
  }

  const sharedGrid = document.getElementById('sharedRoutinesListGrid');
  if (sharedGrid) {
    sharedGrid.innerHTML = Array(4).fill(getRoutineSkeletonHtml()).join('');
  }

  const quickGrid = document.getElementById('quickRoutinesList');
  if (quickGrid && !activeWorkout) {
    quickGrid.innerHTML = Array(2).fill(getRoutineSkeletonHtml()).join('');
  }

  const historyList = document.getElementById('historyTimelineList');
  if (historyList) {
    historyList.innerHTML = Array(3).fill(getHistorySkeletonHtml()).join('');
  }
}

// -------------------------------------------------------------
// DATA MANAGEMENT (SCOPED TO AUTHENTICATED USER)
// -------------------------------------------------------------

let userDataPromise = null;

async function loadUserData() {
  if (!authToken) return;

  renderAllSkeletons();

  userDataPromise = (async () => {
    try {
      const res = await fetch('/api/data', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const json = await res.json();
        appData = {
          exercises: json.exercises || [],
          routines: json.routines || [],
          sharedRoutines: json.sharedRoutines || [],
          history: json.history || []
        };
        if (json.user) currentUser = json.user;
      }
    } catch (e) {
      console.warn('Erro ao carregar dados do usuário:', e);
    }
  })();

  await userDataPromise;
}

async function saveUserData() {
  if (!authToken) return;

  try {
    await fetch('/api/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(appData)
    });
  } catch (e) {
    console.warn('Erro ao salvar dados:', e);
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-zinc-100 text-zinc-950 font-bold' : type === 'warning' ? 'bg-amber-500 text-black font-bold' : 'bg-red-600 text-white font-bold';
  toast.className = `${bg} text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 pointer-events-auto fade-in transition-all border border-black/10`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}" class="w-4 h-4"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  initLucide();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// -------------------------------------------------------------
// MOBILE SCREEN WAKE LOCK
// -------------------------------------------------------------

async function toggleScreenWakeLock() {
  if (!('wakeLock' in navigator)) {
    showToast('Bloqueio de tela não suportado neste navegador.', 'warning');
    return;
  }

  try {
    if (!isWakeLockEnabled) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      isWakeLockEnabled = true;
      updateWakeLockUI(true);
      showToast('Tela mantida acesa durante o treino!');
      wakeLockSentinel.addEventListener('release', () => {
        isWakeLockEnabled = false;
        updateWakeLockUI(false);
      });
    } else {
      if (wakeLockSentinel) {
        await wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
      isWakeLockEnabled = false;
      updateWakeLockUI(false);
      showToast('Tela voltará a apagar normalmente.');
    }
  } catch (err) {
    console.warn('Wake Lock error:', err);
    isWakeLockEnabled = false;
    updateWakeLockUI(false);
  }
}

function updateWakeLockUI(active) {
  const btn = document.getElementById('wakeLockBtn');
  const icon = document.getElementById('wakeLockIcon');
  const text = document.getElementById('wakeLockText');
  if (!btn) return;

  if (active) {
    btn.className = 'bg-zinc-200 border border-white text-zinc-950 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md';
    if (text) text.innerText = 'Tela Fixa (Ativa)';
  } else {
    btn.className = 'flex items-center gap-1.5 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all';
    if (text) text.innerText = 'Tela Acesa';
  }
}

// -------------------------------------------------------------
// TAB NAVIGATION (0.8s SNAPPY SKELETON LOAD)
// -------------------------------------------------------------

const TAB_LOAD_DELAY_MS = 800;
let currentTabLoadingTimeout = null;
let currentActiveTab = 'workout';

function switchTab(tabName, immediate = false) {
  // Scroll suave automático para o topo ao trocar de tela
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  } catch (e) {
    window.scrollTo(0, 0);
  }

  currentActiveTab = tabName;

  // 1. Immediately update navigation tab styles (Desktop & Mobile)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('border-white', 'text-white', 'font-semibold');
    btn.classList.add('border-transparent', 'text-zinc-400', 'font-medium');
  });
  const deskActive = document.getElementById(`desk-tab-${tabName}`);
  if (deskActive) {
    deskActive.classList.add('border-white', 'text-white', 'font-semibold');
    deskActive.classList.remove('border-transparent', 'text-zinc-400');
  }

  ['workout', 'routines', 'exercises', 'history', 'feed'].forEach(t => {
    const mobBtn = document.getElementById(`mob-tab-${t}`);
    if (mobBtn) {
      if (t === tabName) {
        mobBtn.className = 'flex flex-col items-center gap-1 text-white text-[11px] font-semibold py-1';
      } else {
        mobBtn.className = 'flex flex-col items-center gap-1 text-zinc-500 hover:text-zinc-200 text-[11px] font-medium py-1';
      }
    }
  });

  // 2. Hide all tab view sections
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

  const activeContent = document.getElementById(`view-${tabName}`);
  if (!activeContent) return;
  activeContent.classList.remove('hidden');

  // 3. Clear any active loading timer
  if (currentTabLoadingTimeout) {
    clearTimeout(currentTabLoadingTimeout);
    currentTabLoadingTimeout = null;
  }

  const skeletonEl = document.getElementById(`skeleton-${tabName}`);
  const contentEl = document.getElementById(`content-${tabName}`);

  // 4. ACTIVE WORKOUT EXCEPTION:
  // If switching to "workout" and there is an ongoing live workout, show immediately with zero delay!
  if (tabName === 'workout' && activeWorkout !== null && !immediate) {
    if (skeletonEl) skeletonEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    renderWorkoutTab();
    initLucide();
    return;
  }

  // 5. If immediate bypass requested programmatically
  if (immediate) {
    if (skeletonEl) skeletonEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    renderTabContent(tabName);
    initLucide();
    return;
  }

  // 6. Standard Tab Loading Flow: Show Dedicated Skeleton for at least 2000ms (2s)
  if (skeletonEl) skeletonEl.classList.remove('hidden');
  if (contentEl) contentEl.classList.add('hidden');
  initLucide();

  currentTabLoadingTimeout = setTimeout(async () => {
    if (userDataPromise) {
      try { await userDataPromise; } catch (e) { /* ignore */ }
    }
    if (skeletonEl) skeletonEl.classList.add('hidden');
    if (contentEl) {
      contentEl.classList.remove('hidden');
      contentEl.classList.remove('fade-in');
      void contentEl.offsetWidth; // trigger reflow for smooth animation
      contentEl.classList.add('fade-in');
    }
    renderTabContent(tabName);
    initLucide();
    currentTabLoadingTimeout = null;
  }, TAB_LOAD_DELAY_MS);
}

function renderTabContent(tabName) {
  if (tabName === 'routines') renderRoutinesList();
  if (tabName === 'exercises') renderExercisesCatalog();
  if (tabName === 'history') {
    renderHistoryView();
    populateHistoryExerciseSelect();
  }
  if (tabName === 'workout') renderWorkoutTab();
  if (tabName === 'feed') renderFeedTab();
}

function renderAllViews() {
  renderWorkoutTab();
  renderRoutinesList();
  renderExercisesCatalog();
  renderHistoryView();
  populateHistoryExerciseSelect();
}

// -------------------------------------------------------------
// IA COACH SOBRECARGA PROGRESSIVA (EPLEY + PSE / RIR)
// -------------------------------------------------------------

function calculateEstimated1RM(weightKg, reps, pse) {
  const w = parseFloat(weightKg) || 0;
  const r = parseInt(reps, 10) || 0;
  const p = parseFloat(pse) || 8;
  if (w <= 0 || r <= 0) return 0;

  const rir = Math.max(0, 10 - p);
  const effectiveReps = r + rir;
  return w * (1 + effectiveReps / 30);
}

function getSmartProgressionAdvice(exerciseId) {
  const ex = appData.exercises.find(e => e.id === exerciseId);
  const minReps = ex?.targetRepMin || 8;
  const maxReps = ex?.targetRepMax || 12;

  const lastPerf = getLastPerformance(exerciseId);
  if (!lastPerf) {
    return {
      title: 'Definição de Carga Base',
      text: `Primeira sessão registrada. Tente encontrar um peso para ${minReps} a ${maxReps} reps parando em PSE 8 (2 reps na reserva).`,
      targetWeight: null,
      targetRepsText: `${minReps}-${maxReps} reps`
    };
  }

  const lastW = lastPerf.weightKg;
  const lastR = lastPerf.reps;
  const lastP = parseFloat(lastPerf.pse) || 8;

  if (lastR >= maxReps && lastP <= 8.5) {
    const inc = lastW >= 50 ? 5 : 2.5;
    const newWeight = lastW + inc;
    return {
      title: 'Aumentar Peso (+Sobrecarga)',
      text: `Você completou ${lastR} reps com ${lastW}kg (@ PSE ${lastP}). Suba para ${newWeight}kg buscando ${minReps} a ${minReps + 2} reps!`,
      targetWeight: newWeight,
      targetRepsText: `${minReps}-${minReps + 2} reps`
    };
  } else if (lastP >= 9.5) {
    return {
      title: 'Consolidar Carga',
      text: `Série anterior no limite (PSE ${lastP}). Mantenha ${lastW}kg e foque em completar ${lastR} reps com melhor técnica.`,
      targetWeight: lastW,
      targetRepsText: `${lastR} reps`
    };
  } else {
    const targetR = Math.min(maxReps, lastR + 1);
    return {
      title: 'Progredir Repetições (+1 Rep)',
      text: `Último registro: ${lastW}kg × ${lastR} reps (@ PSE ${lastP}). Busque ${targetR} reps hoje com o mesmo peso antes de subir a carga.`,
      targetWeight: lastW,
      targetRepsText: `${targetR} reps`
    };
  }
}

function predictRepsForWeight(exerciseId, newWeightKg) {
  const w = parseFloat(newWeightKg);
  if (!w || w <= 0) return null;

  const lastPerf = getLastPerformance(exerciseId);
  if (!lastPerf) return null;

  const e1rm = calculateEstimated1RM(lastPerf.weightKg, lastPerf.reps, lastPerf.pse);
  if (e1rm <= 0) return null;

  const rawReps = 30 * (e1rm / w - 1) - 2; // for PSE 8 (RIR 2)
  const estimatedReps = Math.max(1, Math.min(35, Math.round(rawReps)));

  return {
    reps: estimatedReps,
    range: `${Math.max(1, estimatedReps - 1)} a ${estimatedReps + 1}`
  };
}

// -------------------------------------------------------------
// WORKOUT SESSION & PSE LOGGING ENGINE
// -------------------------------------------------------------

function renderWorkoutTab() {
  const noActiveDiv = document.getElementById('no-active-workout-section');
  const activeDiv = document.getElementById('active-workout-section');
  const activeHeaderBtn = document.getElementById('activeWorkoutHeaderBtn');

  if (activeWorkout) {
    if (noActiveDiv) noActiveDiv.classList.add('hidden');
    if (activeDiv) activeDiv.classList.remove('hidden');
    if (activeHeaderBtn) activeHeaderBtn.classList.remove('hidden');
    renderActiveWorkoutSession();
  } else {
    if (noActiveDiv) noActiveDiv.classList.remove('hidden');
    if (activeDiv) activeDiv.classList.add('hidden');
    if (activeHeaderBtn) activeHeaderBtn.classList.add('hidden');
    renderQuickRoutines();
    renderLastWorkoutSnapshot();
  }
}

function renderQuickRoutines() {
  const container = document.getElementById('quickRoutinesList');
  if (!container) return;

  if (appData.routines.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-xs text-zinc-500 card-opaque rounded-2xl p-4 text-center border border-zinc-800">
        Nenhuma rotina criada nesta conta. Crie sua primeira rotina na aba "Rotinas" ou inicie um treino livre!
      </div>
    `;
    return;
  }

  container.innerHTML = appData.routines.slice(0, 4).map(rot => {
    const count = (rot.exerciseIds || []).length;
    return `
      <div class="card-opaque border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 flex items-center justify-between gap-3 transition-all">
        <div>
          <h4 class="font-bold text-white text-sm">${escapeHtml(rot.name)}</h4>
          <span class="text-xs text-zinc-400 font-mono">${count} exercício${count === 1 ? '' : 's'}</span>
        </div>
        <button onclick="startWorkoutWithRoutine('${rot.id}')" class="bg-zinc-100 hover:bg-white text-zinc-950 font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-md">
          <i data-lucide="play" class="w-3.5 h-3.5 stroke-[2.5]"></i> Iniciar
        </button>
      </div>
    `;
  }).join('');

  initLucide();
}

function renderLastWorkoutSnapshot() {
  const container = document.getElementById('lastWorkoutSnapshot');
  if (!container) return;

  if (!appData.history || appData.history.length === 0) {
    container.innerHTML = `<p class="text-xs text-zinc-500">Nenhum treino registrado ainda nesta conta.</p>`;
    return;
  }

  const last = appData.history[appData.history.length - 1];
  const totalSets = last.exercises.reduce((acc, ex) => acc + (ex.sets?.length || 0), 0);
  const totalVolume = last.exercises.reduce((acc, ex) => {
    return acc + (ex.sets || []).reduce((sAcc, s) => sAcc + ((s.weightKg || 0) * (s.reps || 0)), 0);
  }, 0);

  container.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div>
        <p class="font-bold text-white text-sm">${escapeHtml(last.routineName)}</p>
        <p class="text-xs text-zinc-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>${formatDate(last.date)}</span>
          <span>•</span>
          <span class="inline-flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3 text-zinc-400"></i> ${formatSeconds(last.durationSeconds || 0)}</span>
        </p>
      </div>
      <div class="flex items-center gap-2 text-xs">
        <span class="card-opaque-subtle px-2.5 py-1 rounded-xl text-zinc-200 font-semibold inline-flex items-center gap-1">
          <i data-lucide="layers" class="w-3 h-3 text-zinc-400"></i>
          <span>${totalSets} séries</span>
        </span>
        <span class="card-opaque-subtle px-2.5 py-1 rounded-xl text-white font-bold inline-flex items-center gap-1">
          <i data-lucide="dumbbell" class="w-3 h-3 text-zinc-300"></i>
          <span>${totalVolume.toLocaleString('pt-BR')} kg</span>
        </span>
      </div>
    </div>
  `;
  initLucide();
}

function startQuickWorkout() {
  activeWorkout = {
    routineId: null,
    title: 'Treino Livre',
    startTime: Date.now(),
    exercises: []
  };
  saveActiveWorkoutState();
  startActiveWorkoutTimer();
  switchTab('workout');
  showToast('Treino livre iniciado! Adicione seus exercícios.');
}

function startWorkoutWithRoutine(routineId) {
  const routine = appData.routines.find(r => r.id === routineId);
  if (!routine) return;

  const workoutExercises = (routine.exerciseIds || []).map(exId => {
    const exObj = appData.exercises.find(e => e.id === exId);
    if (!exObj) return null;

    const lastPerf = getLastPerformance(exId);
    const initialSets = [];
    const numSets = routine.defaultSets || 3;
    for (let i = 1; i <= numSets; i++) {
      initialSets.push({
        setNumber: i,
        weightKg: lastPerf ? lastPerf.weightKg : '',
        reps: lastPerf ? lastPerf.reps : '',
        pse: lastPerf ? lastPerf.pse : '8',
        completed: false
      });
    }

    return {
      exerciseId: exObj.id,
      name: exObj.name,
      muscle: exObj.muscle,
      equipment: exObj.equipment,
      machineSettings: exObj.machineSettings || '',
      lastPerformance: lastPerf,
      notes: '',
      sets: initialSets
    };
  }).filter(Boolean);

  activeWorkout = {
    routineId: routine.id,
    title: routine.name,
    startTime: Date.now(),
    exercises: workoutExercises
  };

  saveActiveWorkoutState();
  startActiveWorkoutTimer();
  switchTab('workout');
  showToast(`Treino "${routine.name}" iniciado! Bom treino!`);
}

function restoreActiveWorkout() {
  const saved = localStorage.getItem(ACTIVE_WORKOUT_KEY);
  if (saved) {
    try {
      activeWorkout = JSON.parse(saved);
      if (activeWorkout && activeWorkout.startTime) {
        startActiveWorkoutTimer();
      }
    } catch (e) {
      activeWorkout = null;
    }
  }
}

function saveActiveWorkoutState() {
  if (activeWorkout) {
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(activeWorkout));
  } else {
    localStorage.removeItem(ACTIVE_WORKOUT_KEY);
  }
}

function startActiveWorkoutTimer() {
  if (activeWorkoutTimerInterval) clearInterval(activeWorkoutTimerInterval);
  updateSessionTimerDisplay();
  activeWorkoutTimerInterval = setInterval(updateSessionTimerDisplay, 1000);
}

function updateSessionTimerDisplay() {
  if (!activeWorkout) return;
  const elapsedSec = Math.floor((Date.now() - activeWorkout.startTime) / 1000);
  const formatted = formatSeconds(elapsedSec);

  const timerEl = document.getElementById('sessionTimerText');
  if (timerEl) timerEl.innerText = formatted;

  const headerTimer = document.getElementById('headerTimerText');
  if (headerTimer) headerTimer.innerText = formatted;
}

function renderActiveWorkoutSession() {
  if (!activeWorkout) return;

  const titleInput = document.getElementById('activeWorkoutTitle');
  if (titleInput) {
    titleInput.value = activeWorkout.title;
    titleInput.oninput = (e) => {
      activeWorkout.title = e.target.value;
      saveActiveWorkoutState();
    };
  }

  const container = document.getElementById('activeWorkoutExercisesList');
  if (!container) return;

  if (activeWorkout.exercises.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-zinc-500 card-opaque rounded-2xl p-6 border border-zinc-800">
        <i data-lucide="dumbbell" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
        <h4 class="text-white font-bold mb-1">Nenhum exercício neste treino ainda</h4>
        <p class="text-xs text-zinc-400 mb-4">Adicione os exercícios da sua sessão abaixo.</p>
        <button onclick="openAddExerciseToSessionModal()" class="bg-zinc-100 hover:bg-white text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs inline-flex items-center gap-1.5 shadow-md">
          <i data-lucide="plus" class="w-4 h-4"></i> Adicionar Exercício
        </button>
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = activeWorkout.exercises.map((item, exIndex) => {
    const exObj = appData.exercises.find(e => e.id === item.exerciseId) || item;
    const lastPerf = item.lastPerformance || getLastPerformance(item.exerciseId);
    const iaAdvice = getSmartProgressionAdvice(item.exerciseId);
    const repMin = exObj.targetRepMin || 8;
    const repMax = exObj.targetRepMax || 12;

    return `
      <div class="card-opaque rounded-2xl p-4 sm:p-5 shadow-lg border border-zinc-800">
        
        <!-- Exercise Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold text-zinc-500">${exIndex + 1}.</span>
              <h3 class="font-extrabold text-white text-base sm:text-lg">${escapeHtml(exObj.name)}</h3>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md card-opaque-subtle text-zinc-300">${escapeHtml(exObj.muscle)}</span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/60 text-zinc-400 border border-zinc-800 inline-flex items-center gap-1"><i data-lucide="target" class="w-3 h-3 text-zinc-400"></i> ${repMin}-${repMax} reps</span>
              ${lastPerf ? `
                <span class="text-[11px] text-zinc-400 ml-1">
                  Último: <strong class="text-white">${lastPerf.weightKg}kg × ${lastPerf.reps}</strong> <span class="text-zinc-300 font-mono">@ PSE ${lastPerf.pse}</span>
                </span>
              ` : ''}
            </div>
          </div>

          <!-- Machine settings edit input & Chart Button -->
          <div class="flex items-center gap-2">
            <button onclick="openExerciseChartModal('${item.exerciseId}')" title="Ver Gráfico de Evolução" class="card-opaque-subtle text-zinc-300 hover:text-white px-2.5 py-1 rounded-xl text-xs flex items-center gap-1.5">
              <i data-lucide="trending-up" class="w-3.5 h-3.5"></i>
              <span class="hidden sm:inline">Evolução</span>
            </button>
            <div class="flex items-center gap-1.5 bg-black/80 border border-zinc-800 px-2.5 py-1 rounded-xl text-xs text-zinc-300">
              <i data-lucide="settings-2" class="w-3.5 h-3.5 text-zinc-400 shrink-0"></i>
              <input type="text" placeholder="Ajustes máquina..." value="${escapeHtml(item.machineSettings || '')}" onchange="updateExerciseMachineSettings(${exIndex}, this.value)" class="bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none w-32 sm:w-44" title="Ajustes da máquina (pino, altura do banco, encosto)">
            </div>
            <button onclick="removeExerciseFromSession(${exIndex})" title="Remover exercício do treino" class="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800">
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- SMART IA COACH BANNER -->
        <div id="iaCoachBanner_${exIndex}" class="mt-3 bg-zinc-900/90 border border-zinc-700/60 rounded-xl p-3 flex items-start gap-2.5 text-xs">
          <div class="w-6 h-6 rounded-lg bg-zinc-800 text-white flex items-center justify-center shrink-0 border border-zinc-700">
            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white text-[11px] uppercase tracking-wider flex items-center gap-1">
                IA Coach • <span class="text-zinc-300">${iaAdvice.title}</span>
              </span>
              <span class="text-[10px] font-mono text-zinc-400 bg-black/60 px-2 py-0.5 rounded border border-zinc-800">${iaAdvice.targetRepsText}</span>
            </div>
            <p class="text-zinc-300 text-xs mt-1 leading-snug">${iaAdvice.text}</p>
          </div>
        </div>

        <!-- Sets Table / Rows (Mobile-First Compact & Touch-Optimized) -->
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left min-w-[300px] sm:min-w-[340px]">
            <thead>
              <tr class="text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800 pb-2">
                <th class="pb-2 w-8 sm:w-10 text-center">Série</th>
                <th class="pb-2 w-20 sm:w-24 text-center">Carga (kg)</th>
                <th class="pb-2 w-14 sm:w-20 text-center">Reps</th>
                <th class="pb-2 w-20 sm:w-24 text-center">
                  <div class="flex items-center justify-center gap-1 cursor-pointer" onclick="openPseModal()" title="O que é PSE?">
                    <span>PSE</span>
                    <i data-lucide="help-circle" class="w-3 h-3 text-zinc-400"></i>
                  </div>
                </th>
                <th class="pb-2 w-12 sm:w-14 text-center">Check</th>
                <th class="pb-2 w-8 text-center"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-800/60 font-medium">
              ${item.sets.map((set, sIdx) => {
                const isCompleted = set.completed;
                return `
                  <tr class="transition-colors ${isCompleted ? 'set-completed' : ''}">
                    <!-- Set Number -->
                    <td class="py-2 text-center font-mono text-xs font-bold text-zinc-400">
                      ${set.setNumber}
                    </td>

                    <!-- Weight Input (kg) with mobile numeric keypad -->
                    <td class="py-2 text-center px-0.5 sm:px-1">
                      <div class="inline-flex items-center justify-center">
                        <input type="number" step="0.5" min="0" max="999" placeholder="0" inputmode="decimal" value="${set.weightKg !== '' ? set.weightKg : ''}" oninput="handleWeightInputLive(${exIndex}, ${sIdx}, this.value)" class="w-16 sm:w-20 input-dark rounded-lg px-1 sm:px-2 py-1.5 text-center font-mono font-bold text-sm text-white">
                      </div>
                    </td>

                    <!-- Reps Input with mobile numeric keypad -->
                    <td class="py-2 text-center px-0.5 sm:px-1">
                      <div class="inline-flex items-center justify-center">
                        <input type="number" step="1" min="0" max="999" placeholder="0" inputmode="numeric" value="${set.reps !== '' ? set.reps : ''}" onchange="updateSetData(${exIndex}, ${sIdx}, 'reps', this.value)" class="w-12 sm:w-16 input-dark rounded-lg px-1 sm:px-2 py-1.5 text-center font-mono font-bold text-sm text-white">
                      </div>
                    </td>

                    <!-- PSE Selector -->
                    <td class="py-2 text-center px-0.5 sm:px-1">
                      <select onchange="updateSetData(${exIndex}, ${sIdx}, 'pse', this.value)" class="w-[74px] sm:w-24 input-dark rounded-lg px-0.5 sm:px-1 py-1.5 text-xs font-bold text-center ${getPseColorClass(set.pse)}">
                        <option value="10" ${set.pse == '10' ? 'selected' : ''}>10 (Falha)</option>
                        <option value="9.5" ${set.pse == '9.5' ? 'selected' : ''}>9.5 (Sem rep)</option>
                        <option value="9" ${set.pse == '9' ? 'selected' : ''}>9 (1 reserva)</option>
                        <option value="8.5" ${set.pse == '8.5' ? 'selected' : ''}>8.5 (1-2 res)</option>
                        <option value="8" ${set.pse == '8' ? 'selected' : ''}>8 (2 reserva)</option>
                        <option value="7.5" ${set.pse == '7.5' ? 'selected' : ''}>7.5 (2-3 res)</option>
                        <option value="7" ${set.pse == '7' ? 'selected' : ''}>7 (3 reserva)</option>
                        <option value="6" ${set.pse == '6' ? 'selected' : ''}>6 (Leve)</option>
                        <option value="5" ${set.pse == '5' ? 'selected' : ''}>&le; 5 (Aquec)</option>
                      </select>
                    </td>

                    <!-- Completed Checkmark Button -->
                    <td class="py-2 text-center px-0.5 sm:px-1">
                      <button onclick="toggleSetCompleted(${exIndex}, ${sIdx})" class="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center mx-auto transition-all ${isCompleted ? 'bg-zinc-100 text-zinc-950 shadow-md font-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'} active:scale-90">
                        <i data-lucide="check" class="w-4 h-4 stroke-[3]"></i>
                      </button>
                    </td>

                    <!-- Delete Set -->
                    <td class="py-2 text-center px-0.5 sm:px-1">
                      <button onclick="removeSetFromExercise(${exIndex}, ${sIdx})" title="Excluir série" class="text-zinc-600 hover:text-red-400 p-1.5">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Add Set Button -->
        <div class="mt-3 flex items-center justify-between">
          <button onclick="addSetToExercise(${exIndex})" class="card-opaque-subtle hover:bg-zinc-800 text-zinc-200 text-xs px-3 py-1.5 rounded-lg border border-zinc-700/80 flex items-center gap-1.5 transition-all">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> + Nova Série
          </button>
          <span class="text-[11px] text-zinc-400 font-mono">
            ${item.sets.filter(s => s.completed).length} de ${item.sets.length} concluídas
          </span>
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

function handleWeightInputLive(exIndex, setIndex, val) {
  updateSetData(exIndex, setIndex, 'weightKg', val);

  if (!activeWorkout || !activeWorkout.exercises[exIndex]) return;
  const exerciseId = activeWorkout.exercises[exIndex].exerciseId;
  const prediction = predictRepsForWeight(exerciseId, val);
  const banner = document.getElementById(`iaCoachBanner_${exIndex}`);

  if (banner && prediction) {
    banner.innerHTML = `
      <div class="w-6 h-6 rounded-lg bg-zinc-800 text-white flex items-center justify-center shrink-0 border border-zinc-700">
        <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
      </div>
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white text-[11px] uppercase tracking-wider">
            IA Coach • Previsão em Tempo Real
          </span>
          <span class="text-[10px] font-mono text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">~${prediction.range} reps</span>
        </div>
        <p class="text-zinc-300 text-xs mt-1">Com <strong>${val}kg</strong> na máquina, busque <strong>${prediction.range} reps</strong> para atingir PSE 8 (2 repetições de reserva).</p>
      </div>
    `;
    initLucide();
  }
}

function getPseColorClass(pseVal) {
  const val = parseFloat(pseVal);
  if (val >= 10) return 'text-red-300';
  if (val >= 9) return 'text-orange-300';
  if (val >= 8) return 'text-amber-300';
  return 'text-zinc-300';
}

function updateSetData(exIndex, setIndex, field, value) {
  if (!activeWorkout || !activeWorkout.exercises[exIndex]) return;
  const set = activeWorkout.exercises[exIndex].sets[setIndex];
  if (!set) return;

  if (field === 'weightKg') {
    set.weightKg = value === '' ? '' : parseFloat(value) || 0;
  } else if (field === 'reps') {
    set.reps = value === '' ? '' : parseInt(value, 10) || 0;
  } else if (field === 'pse') {
    set.pse = value;
  }

  saveActiveWorkoutState();
}

function updateExerciseMachineSettings(exIndex, value) {
  if (!activeWorkout || !activeWorkout.exercises[exIndex]) return;
  activeWorkout.exercises[exIndex].machineSettings = value;

  const origId = activeWorkout.exercises[exIndex].exerciseId;
  const orig = appData.exercises.find(e => e.id === origId);
  if (orig) {
    orig.machineSettings = value;
    saveUserData();
  }

  saveActiveWorkoutState();
}

function toggleSetCompleted(exIndex, setIndex) {
  if (!activeWorkout || !activeWorkout.exercises[exIndex]) return;
  const set = activeWorkout.exercises[exIndex].sets[setIndex];
  if (!set) return;

  set.completed = !set.completed;

  if (set.completed) {
    startRestTimer(90);
  }

  saveActiveWorkoutState();
  renderActiveWorkoutSession();
}

function addSetToExercise(exIndex) {
  if (!activeWorkout || !activeWorkout.exercises[exIndex]) return;
  const sets = activeWorkout.exercises[exIndex].sets;
  const lastSet = sets[sets.length - 1];

  sets.push({
    setNumber: sets.length + 1,
    weightKg: lastSet ? lastSet.weightKg : '',
    reps: lastSet ? lastSet.reps : '',
    pse: lastSet ? lastSet.pse : '8',
    completed: false
  });

  saveActiveWorkoutState();
  renderActiveWorkoutSession();
}

function removeSetFromExercise(exIndex, setIndex) {
  if (!activeWorkout || !activeWorkout.exercises[exIndex]) return;
  const sets = activeWorkout.exercises[exIndex].sets;
  sets.splice(setIndex, 1);
  sets.forEach((s, idx) => s.setNumber = idx + 1);

  saveActiveWorkoutState();
  renderActiveWorkoutSession();
}

function removeExerciseFromSession(exIndex) {
  if (!activeWorkout) return;
  if (!confirm('Remover este exercício do treino atual?')) return;

  activeWorkout.exercises.splice(exIndex, 1);
  saveActiveWorkoutState();
  renderActiveWorkoutSession();
}

function openAddExerciseToSessionModal() {
  document.getElementById('sessionAddExerciseSearch').value = '';
  renderSessionExercisePicker();
  openModal('addExerciseSessionModal');
  initLucide();
}

function renderSessionExercisePicker() {
  const container = document.getElementById('sessionExercisesPickerList');
  if (!container) return;

  const search = (document.getElementById('sessionAddExerciseSearch')?.value || '').toLowerCase();
  const filtered = appData.exercises.filter(e => e.name.toLowerCase().includes(search) || e.muscle.toLowerCase().includes(search));

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-xs text-zinc-500 py-6 text-center">Nenhum exercício encontrado.</p>`;
    return;
  }

  container.innerHTML = filtered.map(ex => {
    return `
      <div onclick="addExerciseToActiveWorkout('${ex.id}')" class="bg-black/60 hover:bg-zinc-800/80 border border-zinc-800 p-2.5 rounded-xl cursor-pointer flex items-center justify-between transition-all">
        <div>
          <span class="font-bold text-white text-xs sm:text-sm block">${escapeHtml(ex.name)}</span>
          <span class="text-[10px] text-zinc-400 font-mono">${escapeHtml(ex.equipment || 'Equipamento')} • ${escapeHtml(ex.machineSettings || 'Sem ajustes anotados')}</span>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded card-opaque-subtle text-zinc-300">${escapeHtml(ex.muscle)}</span>
      </div>
    `;
  }).join('');
}

function addExerciseToActiveWorkout(exerciseId) {
  const exObj = appData.exercises.find(e => e.id === exerciseId);
  if (!exObj || !activeWorkout) return;

  const lastPerf = getLastPerformance(exerciseId);

  activeWorkout.exercises.push({
    exerciseId: exObj.id,
    name: exObj.name,
    muscle: exObj.muscle,
    equipment: exObj.equipment,
    machineSettings: exObj.machineSettings || '',
    lastPerformance: lastPerf,
    notes: '',
    sets: [
      { setNumber: 1, weightKg: lastPerf ? lastPerf.weightKg : '', reps: lastPerf ? lastPerf.reps : '', pse: lastPerf ? lastPerf.pse : '8', completed: false },
      { setNumber: 2, weightKg: lastPerf ? lastPerf.weightKg : '', reps: lastPerf ? lastPerf.reps : '', pse: lastPerf ? lastPerf.pse : '8', completed: false },
      { setNumber: 3, weightKg: lastPerf ? lastPerf.weightKg : '', reps: lastPerf ? lastPerf.reps : '', pse: lastPerf ? lastPerf.pse : '8', completed: false }
    ]
  });

  saveActiveWorkoutState();
  closeModal('addExerciseSessionModal');
  renderActiveWorkoutSession();
  showToast(`"${exObj.name}" adicionado ao treino!`);
}

function cancelActiveWorkout() {
  if (!confirm('Deseja cancelar o treino atual? O progresso desta sessão não será salvo.')) return;

  if (activeWorkoutTimerInterval) clearInterval(activeWorkoutTimerInterval);
  activeWorkout = null;
  saveActiveWorkoutState();
  closeRestTimer();
  renderWorkoutTab();
  showToast('Treino cancelado.');
}

function confirmFinishWorkout() {
  if (!activeWorkout) return;

  const elapsedSec = Math.floor((Date.now() - activeWorkout.startTime) / 1000);
  const totalSets = activeWorkout.exercises.reduce((acc, ex) => acc + (ex.sets?.length || 0), 0);
  const totalVolume = activeWorkout.exercises.reduce((acc, ex) => {
    return acc + (ex.sets || []).reduce((sAcc, s) => sAcc + ((s.weightKg || 0) * (s.reps || 0)), 0);
  }, 0);

  document.getElementById('finishSummaryDuration').innerText = formatSeconds(elapsedSec);
  document.getElementById('finishSummarySets').innerText = totalSets;
  document.getElementById('finishSummaryVolume').innerText = totalVolume.toLocaleString('pt-BR') + ' kg';

  openModal('finishWorkoutModal');
  initLucide();
}

async function saveAndFinishWorkout() {
  if (!activeWorkout) return;

  const elapsedSec = Math.floor((Date.now() - activeWorkout.startTime) / 1000);

  const finishedSession = {
    id: 'wo_' + Date.now(),
    routineId: activeWorkout.routineId,
    routineName: activeWorkout.title,
    date: new Date().toISOString(),
    durationSeconds: elapsedSec,
    exercises: activeWorkout.exercises.map(ex => ({
      exerciseId: ex.exerciseId,
      exerciseName: ex.name,
      muscle: ex.muscle,
      equipment: ex.equipment,
      machineSettings: ex.machineSettings,
      notes: ex.notes,
      sets: ex.sets.map(s => ({
        setNumber: s.setNumber,
        weightKg: parseFloat(s.weightKg) || 0,
        reps: parseInt(s.reps, 10) || 0,
        pse: s.pse || '8',
        completed: s.completed
      }))
    }))
  };

  appData.history.push(finishedSession);
  await saveUserData();

  if (activeWorkoutTimerInterval) clearInterval(activeWorkoutTimerInterval);
  activeWorkout = null;
  saveActiveWorkoutState();
  closeRestTimer();
  closeModal('finishWorkoutModal');

  switchTab('history');
  showToast('Parabéns! Treino salvo com sucesso!');
}

// -------------------------------------------------------------
// REST TIMER (CENTRALIZED, AUDIO ONLY)
// -------------------------------------------------------------

function startRestTimer(seconds = 90) {
  const timerBox = document.getElementById('floatingRestTimer');
  if (timerBox) timerBox.classList.remove('hidden');

  restTimerState.totalSeconds = seconds;
  restTimerState.remainingSeconds = seconds;
  restTimerState.isRunning = true;

  updateRestTimerUI();

  if (restTimerState.interval) clearInterval(restTimerState.interval);

  restTimerState.interval = setInterval(() => {
    if (!restTimerState.isRunning) return;

    restTimerState.remainingSeconds--;
    updateRestTimerUI();

    if (restTimerState.remainingSeconds <= 0) {
      clearInterval(restTimerState.interval);
      restTimerState.isRunning = false;
      playTimerBeep();
      showToast('Tempo de descanso finalizado! Próxima série!', 'warning');
      updateRestTimerUI();
    }
  }, 1000);

  initLucide();
}

function setRestTimer(seconds) {
  startRestTimer(seconds);
}

function addRestTime(seconds) {
  restTimerState.remainingSeconds += seconds;
  restTimerState.totalSeconds += seconds;
  updateRestTimerUI();
}

function toggleRestTimer() {
  restTimerState.isRunning = !restTimerState.isRunning;
  updateRestTimerUI();
}

function closeRestTimer() {
  if (restTimerState.interval) clearInterval(restTimerState.interval);
  restTimerState.isRunning = false;
  const timerBox = document.getElementById('floatingRestTimer');
  if (timerBox) timerBox.classList.add('hidden');
}

function updateRestTimerUI() {
  const display = document.getElementById('restTimerDisplay');
  const bar = document.getElementById('restTimerProgressBar');
  const icon = document.getElementById('restTimerIcon');

  if (display) {
    const mins = Math.floor(Math.max(0, restTimerState.remainingSeconds) / 60);
    const secs = Math.max(0, restTimerState.remainingSeconds) % 60;
    display.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (bar) {
    const pct = Math.max(0, Math.min(100, (restTimerState.remainingSeconds / restTimerState.totalSeconds) * 100));
    bar.style.width = `${pct}%`;
  }

  if (icon) {
    icon.setAttribute('data-lucide', restTimerState.isRunning ? 'pause' : 'play');
    initLucide();
  }
}

// -------------------------------------------------------------
// ROUTINES & SHARED ROUTINES (COMMUNITY CLONING)
// -------------------------------------------------------------

function switchRoutineSubTab(subTab) {
  currentRoutineSubTab = subTab;
  const mineBtn = document.getElementById('routineSubTabMine');
  const sharedBtn = document.getElementById('routineSubTabShared');
  const mineList = document.getElementById('routinesListGrid');
  const sharedList = document.getElementById('sharedRoutinesListGrid');

  if (subTab === 'mine') {
    mineBtn.className = 'text-xs font-bold text-white bg-zinc-800 border border-zinc-700 px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shadow-sm';
    sharedBtn.className = 'text-xs font-medium text-zinc-400 hover:text-white px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all';
    mineList.classList.remove('hidden');
    sharedList.classList.add('hidden');
    renderRoutinesList();
  } else {
    sharedBtn.className = 'text-xs font-bold text-white bg-zinc-800 border border-zinc-700 px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shadow-sm';
    mineBtn.className = 'text-xs font-medium text-zinc-400 hover:text-white px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all';
    sharedList.classList.remove('hidden');
    mineList.classList.add('hidden');
    renderSharedRoutines();
  }
  initLucide();
}

function renderRoutinesList() {
  const container = document.getElementById('routinesListGrid');
  if (!container) return;

  if (appData.routines.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-zinc-500 card-opaque rounded-2xl p-6 border border-zinc-800">
        <i data-lucide="clipboard" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
        <h4 class="text-white font-bold mb-1">Nenhuma rotina criada</h4>
        <p class="text-xs text-zinc-400 mb-4">Crie sua primeira divisão de treino ou explore a aba de Rotinas Compartilhadas!</p>
        <button onclick="openCreateRoutineModal()" class="bg-zinc-100 hover:bg-white text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs inline-flex items-center gap-1.5">
          <i data-lucide="plus" class="w-4 h-4"></i> Criar Rotina Agora
        </button>
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = appData.routines.map(rot => {
    const routineExercises = (rot.exerciseIds || []).map(id => appData.exercises.find(e => e.id === id)).filter(Boolean);

    return `
      <div class="card-opaque rounded-2xl p-5 flex flex-col justify-between border border-zinc-800 hover:border-zinc-700 transition-all">
        <div>
          <div class="flex items-start justify-between gap-3 mb-2">
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-base sm:text-lg text-white">${escapeHtml(rot.name)}</h3>
                ${rot.isPublic ? `
                  <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">Pública</span>
                ` : ''}
              </div>
              ${rot.description ? `<p class="text-xs text-zinc-400 mt-0.5">${escapeHtml(rot.description)}</p>` : ''}
            </div>
            <div class="flex items-center gap-1">
              <button onclick="openCreateRoutineModal('${rot.id}')" title="Editar" class="text-zinc-400 hover:text-white p-1 hover:bg-zinc-800 rounded-lg">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="deleteRoutine('${rot.id}')" title="Excluir" class="text-zinc-400 hover:text-red-400 p-1 hover:bg-zinc-800 rounded-lg">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <div class="mt-4 mb-5">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
              Exercícios (${routineExercises.length}):
            </span>
            <div class="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              ${routineExercises.length > 0 ? routineExercises.map((ex, idx) => `
                <div class="flex items-center justify-between text-xs bg-black/70 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
                  <div class="flex items-center gap-2 truncate">
                    <span class="text-zinc-500 font-mono text-[10px]">${idx + 1}.</span>
                    <span class="font-medium text-zinc-200 truncate">${escapeHtml(ex.name)}</span>
                  </div>
                  <span class="text-[10px] text-zinc-400 font-mono shrink-0">${escapeHtml(ex.muscle)}</span>
                </div>
              `).join('') : `
                <span class="text-xs text-zinc-500 italic">Nenhum exercício selecionado nesta rotina.</span>
              `}
            </div>
          </div>
        </div>

        <button onclick="startWorkoutWithRoutine('${rot.id}')" class="w-full bg-zinc-100 hover:bg-white text-zinc-950 font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md">
          <i data-lucide="play" class="w-4 h-4 stroke-[2.5]"></i>
          Iniciar Treino
        </button>
      </div>
    `;
  }).join('');

  initLucide();
}

function renderSharedRoutines() {
  const container = document.getElementById('sharedRoutinesListGrid');
  if (!container) return;

  const shared = appData.sharedRoutines || [];

  if (shared.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-zinc-500 card-opaque rounded-2xl p-6 border border-zinc-800">
        <i data-lucide="share-2" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
        <h4 class="text-white font-bold mb-1">Nenhuma rotina pública no momento</h4>
        <p class="text-xs text-zinc-400">Quando outros atletas marcarem suas rotinas como públicas, elas aparecerão aqui para você clonar!</p>
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = shared.map(rot => {
    const routineExercises = (rot.exerciseIds || []).map(id => appData.exercises.find(e => e.id === id)).filter(Boolean);

    return `
      <div class="card-opaque rounded-2xl p-5 flex flex-col justify-between border border-zinc-800 hover:border-zinc-700 transition-all">
        <div>
          <div class="flex items-start justify-between gap-3 mb-2">
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-base sm:text-lg text-white">${escapeHtml(rot.name)}</h3>
                <span class="text-[10px] text-zinc-400 font-mono bg-zinc-850 px-2 py-0.5 rounded border border-zinc-700">Por ${escapeHtml(rot.authorName || 'Atleta')}</span>
              </div>
              ${rot.description ? `<p class="text-xs text-zinc-400 mt-1">${escapeHtml(rot.description)}</p>` : ''}
            </div>
          </div>

          <div class="mt-4 mb-5">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
              Exercícios (${routineExercises.length}):
            </span>
            <div class="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              ${routineExercises.map((ex, idx) => `
                <div class="flex items-center justify-between text-xs bg-black/70 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
                  <span class="font-medium text-zinc-200 truncate">${idx + 1}. ${escapeHtml(ex.name)}</span>
                  <span class="text-[10px] text-zinc-400 font-mono">${escapeHtml(ex.muscle)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <button onclick="cloneSharedRoutine('${rot.id}')" class="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95 border border-zinc-700">
          <i data-lucide="copy" class="w-4 h-4"></i>
          Clonar para Minhas Rotinas
        </button>
      </div>
    `;
  }).join('');

  initLucide();
}

async function cloneSharedRoutine(routineId) {
  try {
    const res = await fetch('/api/routines/clone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ routineId })
    });

    const data = await res.json();
    if (res.ok) {
      appData.routines.push(data.routine);
      showToast(data.message || 'Rotina clonada!');
      switchRoutineSubTab('mine');
    } else {
      showToast(data.error || 'Erro ao clonar rotina.', 'warning');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'danger');
  }
}

function openCreateRoutineModal(editId = null) {
  document.getElementById('routineForm').reset();
  document.getElementById('routineEditId').value = editId || '';
  
  const title = document.getElementById('routineModalTitle');
  let selectedIds = [];

  if (editId) {
    title.innerHTML = '<i data-lucide="edit-2" class="w-5 h-5 text-zinc-300"></i> Editar Rotina';
    const rot = appData.routines.find(r => r.id === editId);
    if (rot) {
      document.getElementById('routineNameInput').value = rot.name || '';
      document.getElementById('routineDescInput').value = rot.description || '';
      document.getElementById('routineIsPublicInput').checked = !!rot.isPublic;
      selectedIds = rot.exerciseIds || [];
    }
  } else {
    title.innerHTML = '<i data-lucide="clipboard-list" class="w-5 h-5 text-zinc-300"></i> Nova Rotina de Treino';
    document.getElementById('routineIsPublicInput').checked = false;
  }

  renderRoutineChecklist(selectedIds);
  openModal('routineModal');
  initLucide();
}

function renderRoutineChecklist(selectedIds = []) {
  const container = document.getElementById('routineExercisesChecklist');
  if (!container) return;

  const search = (document.getElementById('routineExerciseSearch')?.value || '').toLowerCase();
  const filtered = appData.exercises.filter(e => e.name.toLowerCase().includes(search) || e.muscle.toLowerCase().includes(search));

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-xs text-zinc-500 p-3 text-center">Nenhum exercício encontrado.</p>`;
    return;
  }

  container.innerHTML = filtered.map(ex => {
    const isChecked = selectedIds.includes(ex.id);
    return `
      <label class="flex items-center justify-between p-2 rounded-lg hover:bg-zinc-900 cursor-pointer text-xs">
        <div class="flex items-center gap-2">
          <input type="checkbox" name="routineExerciseCheckbox" value="${ex.id}" ${isChecked ? 'checked' : ''} onchange="updateSelectedCountBadge()" class="rounded border-zinc-700 bg-black text-white focus:ring-0 w-4 h-4">
          <span class="font-medium text-zinc-200">${escapeHtml(ex.name)}</span>
        </div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-850 text-zinc-400 font-mono">${escapeHtml(ex.muscle)}</span>
      </label>
    `;
  }).join('');

  updateSelectedCountBadge();
}

function filterRoutineExercisePicker() {
  const checked = Array.from(document.querySelectorAll('input[name="routineExerciseCheckbox"]:checked')).map(el => el.value);
  renderRoutineChecklist(checked);
}

function updateSelectedCountBadge() {
  const count = document.querySelectorAll('input[name="routineExerciseCheckbox"]:checked').length;
  const badge = document.getElementById('selectedCountBadge');
  if (badge) badge.innerText = `${count} selecionado${count === 1 ? '' : 's'}`;
}

async function handleSaveRoutine(e) {
  e.preventDefault();
  const editId = document.getElementById('routineEditId').value;
  const name = document.getElementById('routineNameInput').value.trim();
  const description = document.getElementById('routineDescInput').value.trim();
  const isPublic = document.getElementById('routineIsPublicInput').checked;

  const checkedBoxes = Array.from(document.querySelectorAll('input[name="routineExerciseCheckbox"]:checked'));
  const exerciseIds = checkedBoxes.map(cb => cb.value);

  if (!name) return;

  if (editId) {
    const idx = appData.routines.findIndex(r => r.id === editId);
    if (idx !== -1) {
      appData.routines[idx] = {
        ...appData.routines[idx],
        name,
        description,
        exerciseIds,
        isPublic
      };
      showToast('Rotina atualizada com sucesso!');
    }
  } else {
    const newRoutine = {
      id: 'rot_' + Date.now(),
      name,
      description,
      exerciseIds,
      defaultSets: 3,
      isPublic
    };
    appData.routines.push(newRoutine);
    showToast('Nova rotina criada!');
  }

  await saveUserData();
  closeModal('routineModal');
  renderRoutinesList();
  renderWorkoutTab();
}

async function deleteRoutine(id) {
  const rot = appData.routines.find(r => r.id === id);
  if (!rot) return;

  if (!confirm(`Deseja realmente excluir a rotina "${rot.name}"?`)) return;

  appData.routines = appData.routines.filter(r => r.id !== id);
  await saveUserData();
  showToast('Rotina excluída.');
  renderRoutinesList();
  renderWorkoutTab();
}

// -------------------------------------------------------------
// EXERCISES CATALOG
// -------------------------------------------------------------

function openCreateExerciseModal(editId = null) {
  document.getElementById('exerciseForm').reset();
  document.getElementById('exerciseEditId').value = editId || '';
  
  const title = document.getElementById('exerciseModalTitle');
  if (editId) {
    title.innerHTML = '<i data-lucide="edit-2" class="w-5 h-5 text-zinc-300"></i> Editar Exercício';
    const ex = appData.exercises.find(e => e.id === editId);
    if (ex) {
      document.getElementById('exerciseNameInput').value = ex.name || '';
      document.getElementById('exerciseMuscleInput').value = ex.muscle || 'Peito';
      document.getElementById('exerciseEquipmentInput').value = ex.equipment || 'Máquina';
      document.getElementById('exerciseMachineSettingsInput').value = ex.machineSettings || '';
      document.getElementById('exerciseNotesInput').value = ex.notes || '';
      document.getElementById('exerciseTargetRepMinInput').value = ex.targetRepMin || 8;
      document.getElementById('exerciseTargetRepMaxInput').value = ex.targetRepMax || 12;
    }
  } else {
    title.innerHTML = '<i data-lucide="dumbbell" class="w-5 h-5 text-zinc-300"></i> Novo Exercício';
    document.getElementById('exerciseTargetRepMinInput').value = 8;
    document.getElementById('exerciseTargetRepMaxInput').value = 12;
  }

  openModal('exerciseModal');
  initLucide();
}

async function handleSaveExercise(e) {
  e.preventDefault();
  const editId = document.getElementById('exerciseEditId').value;
  const name = document.getElementById('exerciseNameInput').value.trim();
  const muscle = document.getElementById('exerciseMuscleInput').value;
  const equipment = document.getElementById('exerciseEquipmentInput').value;
  const machineSettings = document.getElementById('exerciseMachineSettingsInput').value.trim();
  const notes = document.getElementById('exerciseNotesInput').value.trim();
  const targetRepMin = parseInt(document.getElementById('exerciseTargetRepMinInput').value, 10) || 8;
  const targetRepMax = parseInt(document.getElementById('exerciseTargetRepMaxInput').value, 10) || 12;

  if (!name) return;

  if (editId) {
    const idx = appData.exercises.findIndex(e => e.id === editId);
    if (idx !== -1) {
      appData.exercises[idx] = {
        ...appData.exercises[idx],
        name,
        muscle,
        equipment,
        machineSettings,
        notes,
        targetRepMin,
        targetRepMax
      };
      showToast('Exercício atualizado com sucesso!');
    }
  } else {
    const newEx = {
      id: 'ex_' + Date.now(),
      name,
      muscle,
      equipment,
      machineSettings,
      notes,
      targetRepMin,
      targetRepMax,
      isBase: false
    };
    appData.exercises.push(newEx);
    showToast('Exercício adicionado ao catálogo!');
  }

  await saveUserData();
  closeModal('exerciseModal');
  renderExercisesCatalog();
  renderRoutinesList();
  populateHistoryExerciseSelect();
}

async function deleteExercise(id) {
  const ex = appData.exercises.find(e => e.id === id);
  if (!ex) return;

  if (!confirm(`Deseja realmente excluir o exercício "${ex.name}"?`)) return;

  appData.exercises = appData.exercises.filter(e => e.id !== id);
  appData.routines.forEach(rot => {
    rot.exerciseIds = (rot.exerciseIds || []).filter(exId => exId !== id);
  });

  await saveUserData();
  showToast('Exercício excluído.');
  renderExercisesCatalog();
  renderRoutinesList();
  populateHistoryExerciseSelect();
}

function renderExercisesCatalog() {
  const container = document.getElementById('exercisesCatalogGrid');
  if (!container) return;

  const search = (document.getElementById('exerciseSearchInput')?.value || '').toLowerCase();
  const muscle = document.getElementById('exerciseMuscleFilter')?.value || '';
  const equipment = document.getElementById('exerciseEquipmentFilter')?.value || '';

  const filtered = appData.exercises.filter(ex => {
    const matchSearch = ex.name.toLowerCase().includes(search) || (ex.machineSettings || '').toLowerCase().includes(search);
    const matchMuscle = !muscle || ex.muscle === muscle;
    const matchEquipment = !equipment || ex.equipment === equipment;
    return matchSearch && matchMuscle && matchEquipment;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-zinc-500 card-opaque rounded-2xl p-6 border border-zinc-800">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
        <p class="text-sm">Nenhum exercício encontrado com esses filtros.</p>
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = filtered.map(ex => {
    const lastPerf = getLastPerformance(ex.id);
    const repMin = ex.targetRepMin || 8;
    const repMax = ex.targetRepMax || 12;

    return `
      <div class="card-opaque rounded-2xl p-4 flex flex-col justify-between border border-zinc-800 hover:border-zinc-700 transition-all">
        <div>
          <div class="flex items-start justify-between gap-2 mb-2">
            <h3 class="font-bold text-white text-base leading-snug">${escapeHtml(ex.name)}</h3>
            <div class="flex items-center gap-1">
              <button onclick="openExerciseChartModal('${ex.id}')" title="Ver Gráfico" class="text-zinc-400 hover:text-white p-1 hover:bg-zinc-800 rounded-lg">
                <i data-lucide="trending-up" class="w-4 h-4"></i>
              </button>
              <button onclick="openCreateExerciseModal('${ex.id}')" title="Editar" class="text-zinc-400 hover:text-white p-1 hover:bg-zinc-800 rounded-lg">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="deleteExercise('${ex.id}')" title="Excluir" class="text-zinc-500 hover:text-red-400 p-1 hover:bg-zinc-800 rounded-lg">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5 mb-2.5">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md card-opaque-subtle text-zinc-300">${escapeHtml(ex.muscle)}</span>
            <span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-black/60 text-zinc-400 border border-zinc-800">${escapeHtml(ex.equipment || 'Equipamento')}</span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/60 text-zinc-300 border border-zinc-800 inline-flex items-center gap-1"><i data-lucide="target" class="w-3 h-3 text-zinc-400"></i> ${repMin}-${repMax} reps</span>
          </div>

          ${ex.machineSettings ? `
            <div class="bg-black/70 border border-zinc-800/80 rounded-xl p-2.5 mb-2.5 text-xs text-zinc-300 flex items-start gap-2">
              <i data-lucide="settings-2" class="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5"></i>
              <div>
                <span class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Ajustes da Máquina:</span>
                <span>${escapeHtml(ex.machineSettings)}</span>
              </div>
            </div>
          ` : ''}

          ${ex.notes ? `<p class="text-xs text-zinc-400 italic mb-2">"${escapeHtml(ex.notes)}"</p>` : ''}
        </div>

        <div class="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
          <div>
            ${lastPerf ? `
              <span>Último: <strong class="text-white">${lastPerf.weightKg}kg × ${lastPerf.reps}</strong> <span class="text-zinc-300 font-mono text-[11px]">@ PSE ${lastPerf.pse}</span></span>
            ` : `<span class="text-zinc-500 italic">Sem registros</span>`}
          </div>
          <button onclick="openExerciseChartModal('${ex.id}')" class="text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center gap-1">
            <i data-lucide="line-chart" class="w-3.5 h-3.5"></i> Gráfico
          </button>
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

function getLastPerformance(exerciseId) {
  if (!appData.history || appData.history.length === 0) return null;

  for (let i = appData.history.length - 1; i >= 0; i--) {
    const workout = appData.history[i];
    const exMatch = workout.exercises?.find(e => e.exerciseId === exerciseId);
    if (exMatch && exMatch.sets && exMatch.sets.length > 0) {
      const completedSets = exMatch.sets.filter(s => s.completed !== false && (s.weightKg > 0 || s.reps > 0));
      if (completedSets.length > 0) {
        return completedSets[completedSets.length - 1];
      }
    }
  }
  return null;
}

// -------------------------------------------------------------
// HISTORY & CHARTS
// -------------------------------------------------------------

function getExerciseProgressionData(exerciseId) {
  const dates = [];
  const maxLoads = [];
  const estimated1RMs = [];

  appData.history.forEach(w => {
    const match = w.exercises?.find(e => e.exerciseId === exerciseId);
    if (match && match.sets && match.sets.length > 0) {
      let maxLoad = 0;
      let max1RM = 0;

      match.sets.forEach(s => {
        const wKg = parseFloat(s.weightKg) || 0;
        const r = parseInt(s.reps, 10) || 0;
        const p = parseFloat(s.pse) || 8;
        if (wKg > 0 && r > 0) {
          if (wKg > maxLoad) maxLoad = wKg;
          const e1rm = calculateEstimated1RM(wKg, r, p);
          if (e1rm > max1RM) max1RM = e1rm;
        }
      });

      if (maxLoad > 0) {
        const d = new Date(w.date);
        dates.push(`${d.getDate()}/${d.getMonth() + 1}`);
        maxLoads.push(maxLoad);
        estimated1RMs.push(Math.round(max1RM * 10) / 10);
      }
    }
  });

  return { dates, maxLoads, estimated1RMs };
}

function openExerciseChartModal(exerciseId) {
  const ex = appData.exercises.find(e => e.id === exerciseId);
  if (!ex) return;

  document.getElementById('exerciseChartModalTitle').innerText = ex.name;
  document.getElementById('exerciseChartModalSubtitle').innerText = `${ex.muscle} • ${ex.equipment || 'Equipamento'} (Alvo: ${ex.targetRepMin || 8}-${ex.targetRepMax || 12} reps)`;

  const data = getExerciseProgressionData(exerciseId);
  const detailsEl = document.getElementById('exerciseChartModalDetails');

  if (data.dates.length === 0) {
    detailsEl.innerHTML = `<p class="text-zinc-500 text-center py-2 text-xs">Nenhum treino registrado ainda para este exercício nesta conta.</p>`;
  } else {
    const bestLoad = Math.max(...data.maxLoads);
    const best1RM = Math.max(...data.estimated1RMs);
    const currentLoad = data.maxLoads[data.maxLoads.length - 1];

    detailsEl.innerHTML = `
      <div class="grid grid-cols-3 gap-2 text-center">
        <div>
          <span class="text-[10px] text-zinc-500 uppercase font-bold block">Última Carga</span>
          <span class="font-bold text-white text-sm">${currentLoad} kg</span>
        </div>
        <div>
          <span class="text-[10px] text-zinc-500 uppercase font-bold block">Recorde (PR)</span>
          <span class="font-bold text-zinc-200 text-sm">${bestLoad} kg</span>
        </div>
        <div>
          <span class="text-[10px] text-zinc-500 uppercase font-bold block">1RM Estimado</span>
          <span class="font-bold text-white text-sm">~${best1RM} kg</span>
        </div>
      </div>
    `;
  }

  openModal('exerciseChartModal');
  renderChart('modalChartCanvas', data);
  initLucide();
}

function renderChart(canvasId, data) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  if (canvasId === 'modalChartCanvas' && modalChartInstance) modalChartInstance.destroy();
  if (canvasId === 'historyChartCanvas' && historyChartInstance) historyChartInstance.destroy();

  if (data.dates.length === 0) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#71717a';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nenhum dado registrado para este exercício.', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: [
        {
          label: 'Carga Máxima (kg)',
          data: data.maxLoads,
          borderColor: '#f4f4f5',
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 2.5,
          tension: 0.35,
          pointBackgroundColor: '#ffffff',
          pointRadius: 4,
          fill: true
        },
        {
          label: '1RM Estimado (kg)',
          data: data.estimated1RMs,
          borderColor: '#71717a',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [4, 4],
          tension: 0.35,
          pointBackgroundColor: '#a1a1aa',
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#a1a1aa', font: { size: 11 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a1a1aa', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a1a1aa', font: { size: 10 } }
        }
      }
    }
  });

  if (canvasId === 'modalChartCanvas') modalChartInstance = chart;
  else historyChartInstance = chart;
}

function populateHistoryExerciseSelect() {
  const select = document.getElementById('historyChartExerciseSelect');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = appData.exercises.map(ex => {
    return `<option value="${ex.id}" ${ex.id === currentVal ? 'selected' : ''}>${escapeHtml(ex.name)} (${escapeHtml(ex.muscle)})</option>`;
  }).join('');

  if (!select.value && appData.exercises.length > 0) {
    select.value = appData.exercises[0].id;
  }

  renderHistoryEvolutionChart();
}

function renderHistoryEvolutionChart() {
  const select = document.getElementById('historyChartExerciseSelect');
  if (!select || !select.value) return;

  const data = getExerciseProgressionData(select.value);
  renderChart('historyChartCanvas', data);

  const summary = document.getElementById('historyChartSummary');
  if (summary) {
    if (data.dates.length > 0) {
      const best = Math.max(...data.maxLoads);
      const best1RM = Math.max(...data.estimated1RMs);
      const last = data.maxLoads[data.maxLoads.length - 1];
      summary.innerHTML = `
        <span>Carga Atual: <strong class="text-white">${last} kg</strong></span>
        <span>Recorde (PR): <strong class="text-zinc-200">${best} kg</strong></span>
        <span>1RM Estimado: <strong class="text-white">~${best1RM} kg</strong></span>
      `;
    } else {
      summary.innerHTML = `<span class="text-zinc-500">Sem dados registrados para este exercício ainda.</span>`;
    }
  }
}

function renderHistoryView() {
  const listContainer = document.getElementById('historyTimelineList');
  if (!listContainer) return;

  const totalWorkouts = appData.history.length;
  let totalSets = 0;
  let totalVolume = 0;
  let pseSum = 0;
  let pseCount = 0;

  appData.history.forEach(w => {
    w.exercises?.forEach(ex => {
      (ex.sets || []).forEach(s => {
        totalSets++;
        totalVolume += (s.weightKg || 0) * (s.reps || 0);
        if (s.pse) {
          const p = parseFloat(s.pse);
          if (!isNaN(p)) {
            pseSum += p;
            pseCount++;
          }
        }
      });
    });
  });

  const avgPse = pseCount > 0 ? (pseSum / pseCount).toFixed(1) : '-';

  document.getElementById('statTotalWorkouts').innerText = totalWorkouts;
  document.getElementById('statTotalSets').innerText = totalSets;
  document.getElementById('statTotalVolume').innerText = totalVolume.toLocaleString('pt-BR') + ' kg';
  document.getElementById('statAvgPse').innerText = avgPse;

  if (totalWorkouts === 0) {
    listContainer.innerHTML = `
      <div class="py-12 text-center text-zinc-500 card-opaque rounded-2xl p-6 border border-zinc-800">
        <i data-lucide="calendar-x" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
        <h4 class="text-white font-bold mb-1">Nenhum treino no histórico</h4>
        <p class="text-xs text-zinc-400">Complete e finalize sua primeira sessão na aba "Treinar" para vê-la aqui!</p>
      </div>
    `;
    initLucide();
    return;
  }

  const reversed = [...appData.history].reverse();

  listContainer.innerHTML = reversed.map((workout, idx) => {
    const origIndex = appData.history.length - 1 - idx;
    const workoutSetsCount = workout.exercises.reduce((acc, e) => acc + (e.sets?.length || 0), 0);
    const workoutVolume = workout.exercises.reduce((acc, e) => {
      return acc + (e.sets || []).reduce((sAcc, s) => sAcc + ((s.weightKg || 0) * (s.reps || 0)), 0);
    }, 0);

    return `
      <div class="card-opaque rounded-2xl p-4 sm:p-5 transition-all border border-zinc-800">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-zinc-300"></span>
              <h3 class="font-extrabold text-white text-base sm:text-lg">${escapeHtml(workout.routineName)}</h3>
            </div>
            <p class="text-xs text-zinc-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>${formatDate(workout.date)}</span>
              <span>•</span>
              <span class="inline-flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3 text-zinc-400"></i> ${formatSeconds(workout.durationSeconds || 0)}</span>
            </p>
          </div>

          <div class="flex items-center gap-2">
            <span class="card-opaque-subtle px-2.5 py-1 rounded-xl text-xs font-semibold text-zinc-200 inline-flex items-center gap-1">
              <i data-lucide="layers" class="w-3 h-3 text-zinc-400"></i>
              <span>${workoutSetsCount} séries</span>
            </span>
            <span class="card-opaque-subtle px-2.5 py-1 rounded-xl text-xs font-bold text-white inline-flex items-center gap-1">
              <i data-lucide="dumbbell" class="w-3 h-3 text-zinc-300"></i>
              <span>${workoutVolume.toLocaleString('pt-BR')} kg</span>
            </span>
            <button onclick="deleteWorkoutFromHistory(${origIndex})" title="Excluir" class="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-850 ml-1">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <div class="mt-4 space-y-3">
          ${workout.exercises.map(ex => `
            <div class="bg-black/60 border border-zinc-800/80 rounded-xl p-3">
              <div class="flex items-center justify-between mb-2">
                <span class="font-bold text-zinc-200 text-xs sm:text-sm">${escapeHtml(ex.exerciseName)}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded card-opaque-subtle text-zinc-400 font-mono">${escapeHtml(ex.muscle || '')}</span>
              </div>

              ${ex.machineSettings ? `
                <div class="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
                  <i data-lucide="settings-2" class="w-3 h-3 text-zinc-400"></i>
                  <span>Ajustes: ${escapeHtml(ex.machineSettings)}</span>
                </div>
              ` : ''}

              <div class="flex flex-wrap gap-2">
                ${(ex.sets || []).map(s => `
                  <div class="bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2">
                    <span class="text-zinc-500 text-[10px] font-mono">#${s.setNumber}</span>
                    <span class="font-bold text-white">${s.weightKg}kg × ${s.reps}</span>
                    <span class="font-bold text-[10px] px-1.5 py-0.5 rounded bg-black text-zinc-300 border border-zinc-800" title="PSE">
                      PSE ${s.pse}
                    </span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

async function deleteWorkoutFromHistory(index) {
  if (!confirm('Deseja realmente excluir este registro de treino do histórico?')) return;

  appData.history.splice(index, 1);
  await saveUserData();
  showToast('Registro de treino removido.');
  renderHistoryView();
  renderLastWorkoutSnapshot();
  populateHistoryExerciseSelect();
}

// -------------------------------------------------------------
// MODALS & BACKUP
// -------------------------------------------------------------

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

function openPseModal() {
  openModal('pseModal');
  initLucide();
}

function openBackupModal() {
  openModal('backupModal');
  initLucide();
}

function exportDataJson() {
  const payload = {
    user: currentUser,
    exercises: appData.exercises,
    routines: appData.routines,
    history: appData.history
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `academia_tracker_${currentUser?.name?.replace(/\s+/g, '_') || 'backup'}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Download do backup iniciado!');
}

function importDataJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && Array.isArray(parsed.exercises) && Array.isArray(parsed.routines)) {
        appData.exercises = parsed.exercises;
        appData.routines = parsed.routines;
        appData.history = parsed.history || [];
        await saveUserData();
        closeModal('backupModal');
        renderAllViews();
        showToast('Dados restaurados com sucesso!');
      } else {
        alert('Arquivo JSON inválido.');
      }
    } catch (err) {
      alert('Erro ao processar arquivo JSON.');
    }
  };
  reader.readAsText(file);
}

// -------------------------------------------------------------
// UTILITIES
// -------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSeconds(totalSec) {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Agora';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Há ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Há ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `Há ${diffDays} d`;
    return formatDate(isoStr).split(' ')[0];
  } catch (e) {
    return formatDate(isoStr);
  }
}

// -------------------------------------------------------------
// SOCIAL FEED & ATHLETE DISCOVERY LOGIC
// -------------------------------------------------------------

let feedSearchDebounceTimer = null;
let currentFeedData = [];
let expandedFeedExercises = new Set();

function handleSearchAthletes(query) {
  const container = document.getElementById('feedSearchResults');
  if (!container) return;

  if (feedSearchDebounceTimer) {
    clearTimeout(feedSearchDebounceTimer);
  }

  const cleanQuery = query.trim().replace(/^@/, '');
  if (!cleanQuery) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="flex items-center gap-2 py-3 text-xs text-zinc-400">
      <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-zinc-300"></i>
      <span>Buscando atletas...</span>
    </div>
  `;
  initLucide();

  feedSearchDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(cleanQuery)}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      const users = data.users || [];

      if (users.length === 0) {
        container.innerHTML = `
          <div class="py-3 text-center text-xs text-zinc-500">
            Nenhum atleta encontrado para "<span class="text-zinc-300 font-mono">@${escapeHtml(cleanQuery)}</span>".
          </div>
        `;
        return;
      }

      container.innerHTML = users.map(u => {
        const initials = getInitials(u.name);
        const handle = u.username ? `@${escapeHtml(u.username)}` : `@${escapeHtml(u.name.toLowerCase().replace(/\s+/g, ''))}`;
        const avatarHtml = u.avatarUrl
          ? `<img src="${u.avatarUrl}" alt="${escapeHtml(u.name)}" class="w-10 h-10 rounded-xl object-cover border border-zinc-700" />`
          : `<div class="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center font-bold text-xs text-zinc-300">${initials}</div>`;

        const bioHtml = u.bio ? `<p class="text-[11px] text-zinc-400 truncate mt-0.5">${escapeHtml(u.bio)}</p>` : '';

        const followBtnHtml = u.isFollowing
          ? `<button onclick="toggleFollowAthlete('${u.id}', '${escapeHtml(u.name)}')" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center gap-1.5 transition-all">
               <i data-lucide="user-check" class="w-3.5 h-3.5 text-zinc-300"></i> Seguindo
             </button>`
          : `<button onclick="toggleFollowAthlete('${u.id}', '${escapeHtml(u.name)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-white text-zinc-950 flex items-center gap-1.5 transition-all shadow-sm">
               <i data-lucide="user-plus" class="w-3.5 h-3.5"></i> Seguir
             </button>`;

        return `
          <div class="card-opaque-subtle rounded-2xl p-3 border border-zinc-800 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              ${avatarHtml}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <h4 class="text-xs font-bold text-white truncate">${escapeHtml(u.name)}</h4>
                  <span class="text-[10px] text-zinc-500 font-mono">${handle}</span>
                </div>
                ${bioHtml}
              </div>
            </div>
            <div class="shrink-0">
              ${followBtnHtml}
            </div>
          </div>
        `;
      }).join('');

      initLucide();
    } catch (e) {
      console.error('Erro ao buscar atletas:', e);
      container.innerHTML = `<div class="py-2 text-xs text-red-400">Erro ao buscar atletas. Tente novamente.</div>`;
    }
  }, 300);
}

async function toggleFollowAthlete(targetUserId, targetName) {
  try {
    const res = await fetch('/api/users/follow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ targetUserId })
    });

    const data = await res.json();
    if (res.ok) {
      if (currentUser?.profile) {
        currentUser.profile.following = data.following || [];
      }
      showToast(data.isFollowing ? `Você começou a seguir ${targetName}!` : `Você deixou de seguir ${targetName}.`);

      // Refresh current search results and feed
      const searchInput = document.getElementById('feedSearchInput');
      if (searchInput && searchInput.value.trim()) {
        handleSearchAthletes(searchInput.value);
      }
      renderFeedTab(true);
    } else {
      showToast(data.error || 'Erro ao seguir atleta.', 'warning');
    }
  } catch (e) {
    console.error('Erro ao seguir atleta:', e);
    showToast('Erro de conexão ao seguir atleta.', 'danger');
  }
}

async function renderFeedTab(force = false) {
  const container = document.getElementById('feedTimelineList');
  if (!container) return;

  try {
    const res = await fetch('/api/feed', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!res.ok) {
      container.innerHTML = `<p class="text-xs text-zinc-500 text-center py-6">Não foi possível carregar o feed no momento.</p>`;
      return;
    }

    const data = await res.json();
    currentFeedData = data.feed || [];

    if (currentFeedData.length === 0) {
      container.innerHTML = `
        <div class="card-opaque rounded-3xl p-8 border border-zinc-800 text-center space-y-3.5 shadow-xl">
          <div class="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-zinc-400 mx-auto">
            <i data-lucide="users" class="w-6 h-6"></i>
          </div>
          <div>
            <h4 class="text-sm font-bold text-white">Seu feed de treinos está silencioso</h4>
            <p class="text-xs text-zinc-400 max-w-sm mx-auto mt-1 leading-relaxed">
              Você ainda não segue nenhum atleta ou quem você segue ainda não registrou treinos.
              Use a busca acima para encontrar e seguir seus amigos pelo @nome de usuário!
            </p>
          </div>
        </div>
      `;
      initLucide();
      return;
    }

    container.innerHTML = currentFeedData.map(item => {
      const initials = getInitials(item.authorName);
      const handle = item.authorUsername ? `@${escapeHtml(item.authorUsername)}` : '';
      const avatarHtml = item.authorAvatarUrl
        ? `<img src="${item.authorAvatarUrl}" alt="${escapeHtml(item.authorName)}" class="w-10 h-10 rounded-xl object-cover border border-zinc-700" />`
        : `<div class="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center font-bold text-xs text-zinc-300">${initials}</div>`;

      // Calculate total volume & total sets
      let totalVolume = 0;
      let totalSets = 0;
      (item.exercises || []).forEach(ex => {
        (ex.sets || []).forEach(s => {
          totalSets++;
          totalVolume += (parseFloat(s.weightKg) || 0) * (parseInt(s.reps, 10) || 0);
        });
      });

      const isExpanded = expandedFeedExercises.has(item.id);

      // Exercise summary list
      const exercisesListHtml = (item.exercises || []).map(ex => {
        const setsCount = (ex.sets || []).length;
        const maxWeight = Math.max(0, ...(ex.sets || []).map(s => parseFloat(s.weightKg) || 0));
        const maxPse = Math.max(0, ...(ex.sets || []).map(s => parseFloat(s.pse) || 0));

        let detailedSetsHtml = '';
        if (isExpanded) {
          detailedSetsHtml = `
            <div class="mt-2 space-y-1 pl-3 border-l border-zinc-800 text-[11px] font-mono text-zinc-400">
              ${(ex.sets || []).map((s, idx) => `
                <div class="flex items-center justify-between">
                  <span>Série ${idx + 1}: ${s.reps || 0} reps @ ${s.weightKg || 0} kg</span>
                  <span class="text-zinc-500">PSE ${s.pse || '--'}</span>
                </div>
              `).join('')}
            </div>
          `;
        }

        return `
          <div class="p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-850">
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold text-zinc-200">${escapeHtml(ex.name)}</span>
              <div class="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                <span>${setsCount} séries</span>
                ${maxWeight > 0 ? `<span class="text-white font-bold">• até ${maxWeight} kg</span>` : ''}
                ${maxPse > 0 ? `<span class="text-zinc-500">(PSE ${maxPse})</span>` : ''}
              </div>
            </div>
            ${detailedSetsHtml}
          </div>
        `;
      }).join('');

      return `
        <article class="card-opaque rounded-3xl p-5 border border-zinc-800 shadow-xl space-y-4 fade-in">
          <!-- Card Header: Author & Date -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              ${avatarHtml}
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-xs font-bold text-white truncate">${escapeHtml(item.authorName)}</span>
                  ${handle ? `<span class="text-[10px] text-zinc-500 font-mono">${handle}</span>` : ''}
                </div>
                <div class="flex items-center gap-1 text-[11px] text-zinc-400 mt-0.5">
                  <i data-lucide="dumbbell" class="w-3 h-3 text-zinc-500"></i>
                  <span class="font-medium text-zinc-300 truncate">${escapeHtml(item.routineName)}</span>
                </div>
              </div>
            </div>
            <span class="text-[11px] text-zinc-500 font-mono shrink-0">${formatRelativeTime(item.date)}</span>
          </div>

          <!-- Workout Metrics Badges -->
          <div class="flex flex-wrap gap-2 text-xs">
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-medium">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-zinc-400"></i>
              <span>${Math.round((item.durationSeconds || 0) / 60)} min</span>
            </div>
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-medium">
              <i data-lucide="layers" class="w-3.5 h-3.5 text-zinc-400"></i>
              <span>${totalSets} séries</span>
            </div>
            ${totalVolume > 0 ? `
              <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-medium">
                <i data-lucide="zap" class="w-3.5 h-3.5 text-zinc-400"></i>
                <span class="font-mono">${totalVolume.toLocaleString('pt-BR')} kg volume</span>
              </div>
            ` : ''}
          </div>

          <!-- Exercises List -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-[11px] uppercase font-bold text-zinc-500 px-1">
              <span>Exercícios do Treino (${(item.exercises || []).length})</span>
              <button onclick="toggleFeedItemExercises('${item.id}')" class="text-zinc-400 hover:text-white flex items-center gap-1 lowercase font-normal">
                ${isExpanded ? 'recolher detalhes' : 'ver séries detalhadas'}
                <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" class="w-3 h-3"></i>
              </button>
            </div>
            ${exercisesListHtml}
          </div>

          <!-- Card Footer: Like Button & Interactive -->
          <div class="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
            <button
              id="like-btn-${item.id}"
              onclick="toggleLikeFeedWorkout('${item.id}', this)"
              class="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs transition-all ${
                item.isLiked
                  ? 'bg-zinc-100 text-zinc-950 font-bold border-white shadow-sm'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-750 font-semibold'
              }"
            >
              <i data-lucide="thumbs-up" class="w-3.5 h-3.5 ${item.isLiked ? 'fill-current' : ''}"></i>
              <span class="like-label">${item.isLiked ? 'Curtiu' : 'Curtir'}</span>
              <span class="like-count font-mono font-bold">${item.likesCount || 0}</span>
            </button>

            <span class="text-[10px] text-zinc-500 font-mono">${formatDate(item.date).split(' ')[0]}</span>
          </div>
        </article>
      `;
    }).join('');

    initLucide();
  } catch (e) {
    console.error('Erro ao renderizar feed:', e);
    container.innerHTML = `<p class="text-xs text-red-400 text-center py-6">Erro ao carregar feed social.</p>`;
  }
}

function toggleFeedItemExercises(workoutId) {
  if (expandedFeedExercises.has(workoutId)) {
    expandedFeedExercises.delete(workoutId);
  } else {
    expandedFeedExercises.add(workoutId);
  }
  renderFeedTab(true);
}

async function toggleLikeFeedWorkout(workoutId, btnEl) {
  try {
    const res = await fetch('/api/history/like', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ workoutId })
    });

    const data = await res.json();
    if (res.ok) {
      const countEl = btnEl.querySelector('.like-count');
      const labelEl = btnEl.querySelector('.like-label');

      if (data.isLiked) {
        btnEl.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs transition-all bg-zinc-100 text-zinc-950 font-bold border-white shadow-sm';
        if (labelEl) labelEl.innerText = 'Curtiu';
      } else {
        btnEl.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs transition-all bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-750 font-semibold';
        if (labelEl) labelEl.innerText = 'Curtir';
      }
      if (countEl) countEl.innerText = data.likesCount;
      initLucide();
    } else {
      showToast(data.error || 'Erro ao curtir treino.', 'warning');
    }
  } catch (e) {
    console.error('Erro ao curtir treino:', e);
    showToast('Erro ao registrar curtida.', 'danger');
  }
}
