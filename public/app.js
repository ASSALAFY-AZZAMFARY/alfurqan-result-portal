/**
 * ALFURQAN SCIENCE ACADEMY GUSAU PWA - Core Controller App
 */

// CHANGE THIS TO YOUR EXACT LIVE GOOGLE APPS SCRIPT WEB APP ENDPOINT URL
const CONFIG = {
  BACKEND_API_URL: "https://script.google.com/macros/s/AKfycbxhreulykBdq7B8pzO_g0_ibNIJ6L8PVreRQpR8FwtpHH9PvODHcnOrdjXBwQfL7dcl/exec"
};

// --- CLIENT STATE STORE ---
const state = {
  sessionToken: localStorage.getItem('session_token') || null,
  role: localStorage.getItem('session_role') || null,
  userName: localStorage.getItem('session_user_name') || null,
  isOnline: navigator.onLine,
  studentData: null,
  teacherData: null,
  adminData: null,
  selectedMutationType: 'create' // helper for student modal action routing
};

// --- APPLICATION STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
  viewManager.syncNetworkState();
  window.addEventListener('online', () => viewManager.syncNetworkState());
  window.addEventListener('offline', () => viewManager.syncNetworkState());
  authManager.attemptSessionAutoResume();
});

// --- API COMMUNICATIONS INTERFACE ---
const apiService = {
  async securePost(payload) {
    if (!state.isOnline) {
      alert("No connection found. Changes cannot be synchronized in offline mode.");
      return { success: false, error: 'Offline fallback.' };
    }
    viewManager.setLoading(true);
    try {
      const response = await fetch(CONFIG.BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Server rejected transaction.');
      return data;
    } catch (e) {
      alert(`API Error: ${e.message}`);
      return { success: false, error: e.message };
    } finally {
      viewManager.setLoading(false);
    }
  },

  async fetchAndRenderStudent(studentId, parentPhone) {
    const res = await this.securePost({
      action: 'getStudentResult',
      studentId,
      parentPhone
    });
    if (res.success) {
      state.studentData = res;
      localStorage.setItem('cached_student_data', JSON.stringify(res));
      viewManager.renderStudentDashboard(res);
    }
  },

  async triggerReportCardDownload() {
    if (!state.studentData) return;
    const res = await this.securePost({
      action: 'generatePDFReport',
      studentId: state.studentData.studentProfile.id,
      auth: state.sessionToken
    });
    if (res.success && res.pdfUrl) {
      window.open(res.pdfUrl, '_blank');
    }
  },

  async commitScores() {
    const inputs = document.querySelectorAll('.score-input');
    const scores = [];
    inputs.forEach(input => {
      const studentId = input.dataset.student;
      const type = input.dataset.type;
      let val = input.value;
      
      let record = scores.find(s => s.studentId === studentId);
      if (!record) {
        record = { studentId, ca1: "", ca2: "", assignment: "", notebook: "", exam: "" };
        scores.push(record);
      }
      record[type] = val !== "" ? parseFloat(val) : "";
    });

    const res = await this.securePost({
      action: 'saveScores',
      auth: state.sessionToken,
      scores
    });
    if (res.success) {
      alert(res.message);
    }
  },

  async commitStudentMutation(event) {
    event.preventDefault();
    const payload = {
      id: document.getElementById('sm-id').value,
      name: document.getElementById('sm-name').value,
      phone: document.getElementById('sm-phone').value,
      class: document.getElementById('sm-class').value,
      arm: document.getElementById('sm-arm').value,
      section: document.getElementById('sm-section').value,
      gender: document.getElementById('sm-gender').value,
      photoId: document.getElementById('sm-photoId').value
    };

    const res = await this.securePost({
      action: 'adminMutateStudent',
      auth: state.sessionToken,
      mutation: state.selectedMutationType,
      payload
    });

    if (res.success) {
      alert("Student database modified successfully.");
      viewManager.closeStudentModal();
      authManager.attemptSessionAutoResume(); // Refresh dashboard data securely
    }
  },

  async deleteStudent(studentId) {
    if (!confirm(`Are you sure you want to permanently delete student ${studentId}? All academic score data will be lost.`)) return;
    const res = await this.securePost({
      action: 'adminMutateStudent',
      auth: state.sessionToken,
      mutation: 'delete',
      payload: { id: studentId }
    });
    if (res.success) {
      alert("Student deleted successfully.");
      authManager.attemptSessionAutoResume();
    }
  }
};

// --- AUTHENTICATION ENGINE ---
const authManager = {
  async studentLogin(e) {
    e.preventDefault();
    const studentId = document.getElementById('student-id').value.trim();
    const phone = document.getElementById('parent-phone').value.trim();
    
    const res = await apiService.securePost({
      action: 'studentLogin',
      studentId,
      parentPhone: phone
    });

    if (res.success) {
      state.role = 'student';
      state.userName = res.studentName;
      state.sessionToken = UtilitiesMock.createToken(studentId, phone);
      
      this.persistSession(state.role, state.userName, state.sessionToken);
      apiService.fetchAndRenderStudent(studentId, phone);
    } else {
      alert("Login Error: Please verify credentials and confirm status is active.");
    }
  },

  async staffLogin(e) {
    e.preventDefault();
    const user = document.getElementById('staff-user').value.trim();
    const pass = document.getElementById('staff-pass').value.trim();

    const res = await apiService.securePost({
      action: 'login',
      username: user,
      password: pass
    });

    if (res.success) {
      state.role = res.user.isAdmin ? 'admin' : 'teacher';
      state.userName = res.user.name;
      state.sessionToken = res.token;

      this.persistSession(state.role, state.userName, state.sessionToken);
      this.routeSessionToView();
    } else {
      alert(res.error);
    }
  },

  persistSession(role, name, token) {
    localStorage.setItem('session_role', role);
    localStorage.setItem('session_user_name', name);
    localStorage.setItem('session_token', token);
  },

  attemptSessionAutoResume() {
    if (state.sessionToken && state.role) {
      this.routeSessionToView();
    } else {
      viewManager.showView('login-screen');
    }
  },

  async routeSessionToView() {
    document.getElementById('display-name').innerText = state.userName.toUpperCase();
    document.getElementById('user-display').classList.remove('hidden');
    document.getElementById('user-display').classList.add('flex');

    if (state.role === 'student') {
      // Re-hydrate view from high-performance cache while syncing network online in parallel
      const cached = localStorage.getItem('cached_student_data');
      if (cached) viewManager.renderStudentDashboard(JSON.parse(cached));
      
      const parts = UtilitiesMock.decodeToken(state.sessionToken);
      if (parts) apiService.fetchAndRenderStudent(parts[0], parts[1]);
    } 
    else if (state.role === 'teacher') {
      const res = await apiService.securePost({ action: 'getTeacherContext', auth: state.sessionToken });
      if (res.success) viewManager.renderTeacherDashboard(res);
    } 
    else if (state.role === 'admin') {
      const res = await apiService.securePost({ action: 'getAdminDashboard', auth: state.sessionToken });
      if (res.success) viewManager.renderAdminDashboard(res);
    }
  },

  logout() {
    localStorage.clear();
    state.sessionToken = null;
    state.role = null;
    state.userName = null;
    state.studentData = null;
    document.getElementById('user-display').classList.add('hidden');
    viewManager.showView('login-screen');
  }
};

// --- INTERACTIVE VIEW MANAGER & DOM COMPILER ---
const viewManager = {
  showView(id) {
    ['login-screen', 'student-dashboard', 'teacher-portal', 'admin-dashboard'].forEach(vId => {
      document.getElementById(vId).classList.add('hidden');
    });
    document.getElementById(id).classList.remove('hidden');
  },

  toggleLoginTab(tab) {
    const studentBtn = document.getElementById('tab-student');
    const staffBtn = document.getElementById('tab-staff');
    const studentForm = document.getElementById('student-form');
    const staffForm = document.getElementById('staff-form');

    if (tab === 'student') {
      studentBtn.className = "flex-1 py-2 text-center text-sm font-semibold rounded-md bg-white text-blue-900 shadow";
      staffBtn.className = "flex-1 py-2 text-center text-sm font-semibold rounded-md text-slate-500 hover:text-slate-800";
      studentForm.classList.remove('hidden');
      staffForm.classList.add('hidden');
    } else {
      staffBtn.className = "flex-1 py-2 text-center text-sm font-semibold rounded-md bg-white text-blue-900 shadow";
      studentBtn.className = "flex-1 py-2 text-center text-sm font-semibold rounded-md text-slate-500 hover:text-slate-800";
      staffForm.classList.remove('hidden');
      studentForm.classList.add('hidden');
    }
  },

  setLoading(show) {
    const shield = document.getElementById('spinner-shield');
    if (show) shield.classList.replace('hidden', 'flex');
    else shield.classList.replace('flex', 'hidden');
  },

  syncNetworkState() {
    state.isOnline = navigator.onLine;
    const tag = document.getElementById('offline-tag');
    if (state.isOnline) {
      tag.classList.add('hidden');
    } else {
      tag.classList.remove('hidden');
    }
  },

  renderStudentDashboard(data) {
    this.showView('student-dashboard');
    document.getElementById('profile-name').innerText = data.studentProfile.name;
    document.getElementById('profile-id').innerText = data.studentProfile.id;
    document.getElementById('profile-class').innerText = data.studentProfile.class;
    document.getElementById('profile-arm').innerText = data.studentProfile.arm;
    document.getElementById('student-pic').src = data.assets.studentBase64 || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80";

    // Setup Top Announcement Block if active
    if (data.announcements && data.announcements.length > 0) {
      const activeAnnounce = data.announcements[0];
      document.getElementById('student-announcement-text').innerText = `${activeAnnounce.title} - ${activeAnnounce.message}`;
      document.getElementById('student-billboard').classList.remove('hidden');
    }

    // Set high-level analytics widgets
    document.getElementById('stat-total').innerText = data.performance.totalScore;
    document.getElementById('stat-avg').innerText = `${data.performance.average.toFixed(1)}%`;
    document.getElementById('stat-rank').innerText = `${data.performance.position} of ${data.performance.classSize}`;
    document.getElementById('stat-verdict').innerText = data.performance.principalRemark;

    // Render results grid
    const tbody = document.getElementById('student-results-body');
    tbody.innerHTML = "";
    
    data.subjects.forEach(sub => {
      const tr = document.createElement('tr');
      tr.className = "border-b border-slate-100 hover:bg-slate-50";
      tr.innerHTML = `
        <td class="p-4 font-bold text-slate-700">${sub.subject}</td>
        <td class="p-4 text-center">${sub.ca1}</td>
        <td class="p-4 text-center">${sub.ca2}</td>
        <td class="p-4 text-center">${sub.assignment}</td>
        <td class="p-4 text-center">${sub.notebook}</td>
        <td class="p-4 text-center">${sub.exam}</td>
        <td class="p-4 text-center font-bold">${sub.total}</td>
        <td class="p-4 text-center"><span class="bg-blue-100 text-blue-900 px-2 py-0.5 rounded font-bold">${sub.grade}</span></td>
        <td class="p-4 text-center text-slate-500">${sub.remark}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderTeacherDashboard(data) {
    this.showView('teacher-portal');
    document.getElementById('teacher-subject').innerText = data.user.assignedSubject;
    document.getElementById('teacher-class').innerText = data.user.assignedClass;

    const tbody = document.getElementById('teacher-entry-body');
    tbody.innerHTML = "";

    data.students.forEach(student => {
      const existing = data.currentScores[student.id.toUpperCase()] || { ca1: "", ca2: "", assignment: "", notebook: "", exam: "" };
      
      const tr = document.createElement('tr');
      tr.className = "border-b border-slate-100 hover:bg-slate-50";
      tr.innerHTML = `
        <td class="p-4 font-mono text-xs font-semibold text-slate-500">${student.id}</td>
        <td class="p-4 font-bold text-slate-700">${student.name}</td>
        <td class="p-2"><input type="number" min="0" max="15" step="0.5" data-student="${student.id}" data-type="ca1" value="${existing.ca1}" class="score-input w-16 mx-auto block text-center border p-1 rounded"></td>
        <td class="p-2"><input type="number" min="0" max="15" step="0.5" data-student="${student.id}" data-type="ca2" value="${existing.ca2}" class="score-input w-16 mx-auto block text-center border p-1 rounded"></td>
        <td class="p-2"><input type="number" min="0" max="5" step="0.5" data-student="${student.id}" data-type="assignment" value="${existing.assignment}" class="score-input w-16 mx-auto block text-center border p-1 rounded"></td>
        <td class="p-2"><input type="number" min="0" max="5" step="0.5" data-student="${student.id}" data-type="notebook" value="${existing.notebook}" class="score-input w-16 mx-auto block text-center border p-1 rounded"></td>
        <td class="p-2"><input type="number" min="0" max="60" step="0.5" data-student="${student.id}" data-type="exam" value="${existing.exam}" class="score-input w-20 mx-auto block text-center border p-1 rounded font-bold"></td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderAdminDashboard(data) {
    this.showView('admin-dashboard');
    
    // 1. Render student records with inline modifications
    const sBody = document.getElementById('admin-students-list');
    sBody.innerHTML = "";
    data.students.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = "border-b hover:bg-slate-50 text-sm";
      tr.innerHTML = `
        <td class="p-4 font-mono font-bold text-blue-900">${s.id}</td>
        <td class="p-4 font-semibold text-slate-800">${s.name}</td>
        <td class="p-4">${s.class} (${s.arm})</td>
        <td class="p-4">${s.phone}</td>
        <td class="p-4 text-right space-x-2">
          <button onclick="viewManager.openStudentModal('update', ${JSON.stringify(s).replace(/"/g, '&quot;')})" class="text-blue-600 hover:text-blue-900"><i class="fa-solid fa-pen"></i></button>
          <button onclick="apiService.deleteStudent('${s.id}')" class="text-red-500 hover:text-red-800"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      sBody.appendChild(tr);
    });

    // Populate school dynamic runtime configurations
    document.getElementById('cfg-school-name').value = data.settings['School Name'] || '';
    document.getElementById('cfg-school-address').value = data.settings['School Address'] || '';
    document.getElementById('cfg-school-email').value = data.settings['School Email'] || '';
    document.getElementById('cfg-school-logo').value = data.settings['Logo Image ID'] || '';
  },

  switchAdminTab(tabId) {
    ['students', 'settings', 'announcements'].forEach(id => {
      document.getElementById(`admin-${id}`).classList.add('hidden');
    });
    document.getElementById(`admin-${tabId}`).classList.remove('hidden');
  },

  openStudentModal(type, item = null) {
    state.selectedMutationType = type;
    const modal = document.getElementById('student-modal');
    const title = document.getElementById('student-modal-title');
    modal.classList.replace('hidden', 'flex');

    if (type === 'create') {
      title.innerText = "Enroll New Student";
      document.getElementById('student-modal-form').reset();
      document.getElementById('sm-id').removeAttribute('disabled');
    } else {
      title.innerText = "Edit Student Profile";
      document.getElementById('sm-id').value = item.id;
      document.getElementById('sm-id').setAttribute('disabled', 'true');
      document.getElementById('sm-name').value = item.name;
      document.getElementById('sm-phone').value = item.phone;
      document.getElementById('sm-class').value = item.class;
      document.getElementById('sm-arm').value = item.arm;
      document.getElementById('sm-section').value = item.section;
      document.getElementById('sm-gender').value = item.gender;
      document.getElementById('sm-photoId').value = item.photoId;
    }
  },

  closeStudentModal() {
    document.getElementById('student-modal').classList.replace('flex', 'hidden');
  }
};

// --- LIGHTWEIGHT LOCAL ENCODING/DECODING ENGINE ---
const UtilitiesMock = {
  createToken(p1, p2) {
    return btoa(`${p1}:${p2}`);
  },
  decodeToken(token) {
    try {
      return atob(token).split(':');
    } catch (e) {
      return null;
    }
  }
};
