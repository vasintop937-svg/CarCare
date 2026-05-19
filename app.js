
// CarDiary — app.js (оптимизированная версия)
// Firebase config
window.onerror = function(msg, src, line, col, err) {
  const app = document.getElementById('app');
  if (app && app.innerHTML === '') {
    app.innerHTML = '<div style="padding:20px;color:#EF4444;font-family:monospace;font-size:12px;word-break:break-all">' +
      '<b>Error:</b> ' + msg + '<br><b>Line:</b> ' + line + ':' + col + '</div>';
  }
  return false;
};

firebase.initializeApp({
  apiKey: "AIzaSyAPAtCBZVbGJgyFZ682zYMpHif7CKzdtKs",
  authDomain: "car-diary-d3e7f.firebaseapp.com",
  projectId: "car-diary-d3e7f",
  storageBucket: "car-diary-d3e7f.firebasestorage.app",
  messagingSenderId: "724496184070",
  appId: "1:724496184070:web:a5a8b5097e6e15c5f26487"
});

const db = firebase.firestore();
const auth = firebase.auth();
let currentUser = null;

const SK = 'cardiary_v8';
const syncInd = document.getElementById('sync-ind');
function showSync() { if(syncInd) syncInd.style.display='block'; }
function hideSync() { if(syncInd) syncInd.style.display='none'; }

// ========== DEBOUNCE SAVE ==========
let _saveTimeout = null;

function getUserDoc() {
  if (!currentUser) return null;
  return db.collection('users').doc(currentUser.uid);
}

function getCarDoc(carId) {
  return db.collection('shared_cars').doc(carId);
}

function load() {
  try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : {cars:[],records:[],reminders:[],planned:[],stations:[]}; }
  catch(e) { return {cars:[],records:[],reminders:[],planned:[],stations:[]}; }
}

// Сохранение с debounce
function save(d) {
  try { localStorage.setItem(SK, JSON.stringify(d)); } catch(e) {}
  if (!currentUser) return;

  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(function() {
    saveNow(d);
  }, 2000);
}

// Мгновенное сохранение для важных операций
function saveNow(d) {
  try { localStorage.setItem(SK, JSON.stringify(d)); } catch(e) {}
  if (!currentUser) return;
  showSync();

  const carIds = (d.cars||[]).map(function(c){ return c.id; });
  const promises = (d.cars||[]).map(function(car) {
    const carData = {
      car: car,
      records: (d.records||[]).filter(function(r){ return r.carId===car.id; }),
      reminders: (d.reminders||[]).filter(function(r){ return r.carId===car.id; }),
      planned: (d.planned||[]).filter(function(p){ return p.carId===car.id; }),
    };
    return getCarDoc(car.id).get().then(function(snap) {
      const existingOwners = snap.exists ? (snap.data().owners || []) : [];
      if (existingOwners.indexOf(currentUser.uid) === -1) existingOwners.push(currentUser.uid);
      return getCarDoc(car.id).set({
        data: JSON.stringify(carData),
        updated: Date.now(),
        owners: existingOwners,
        inviteCode: car.inviteCode || ''
      }, {merge: true});
    });
  });
  promises.push(getUserDoc().set({
    carIds: carIds,
    stations: d.stations || [],
    updated: Date.now()
  }, {merge: true}));

  Promise.all(promises)
    .then(function(){ hideSync(); })
    .catch(function(err){ 
      hideSync(); 
      console.error('Sync error:', err); 
    });
}

// Загрузка из облака
function loadFromCloud(callback) {
  if (!currentUser) { callback(load()); return; }
  showSync();

  getUserDoc().get().then(function(userSnap) {
    let carIds = [];
    let stations = [];

    if (userSnap.exists) {
      carIds = userSnap.data().carIds || [];
      stations = userSnap.data().stations || [];
    } else {
      hideSync(); callback({cars:[],records:[],reminders:[],planned:[],stations:[]}); return;
    }

    if (carIds.length === 0) {
      hideSync(); callback({cars:[],records:[],reminders:[],planned:[],stations:stations}); return;
    }

    const promises = carIds.map(function(cid){ return getCarDoc(cid).get(); });
    Promise.all(promises).then(function(snaps) {
      hideSync();
      const merged = {cars:[],records:[],reminders:[],planned:[],stations:stations};
      snaps.forEach(function(snap) {
        if (!snap.exists) return;
        try {
          const cd = JSON.parse(snap.data().data);
          if (cd.car) {
            cd.car.inviteCode = snap.data().inviteCode || '';
            merged.cars.push(cd.car);
          }
          merged.records = merged.records.concat(cd.records||[]);
          merged.reminders = merged.reminders.concat(cd.reminders||[]);
          merged.planned = merged.planned.concat(cd.planned||[]);
        } catch(e) {}
      });
      localStorage.setItem(SK, JSON.stringify(merged));
      callback(merged);
    }).catch(function(){ hideSync(); callback(load()); });

  }).catch(function(){ hideSync(); callback(load()); });
}

function migrateOldData(callback) {
  const oldDoc = db.collection('users').doc(currentUser.uid);
  oldDoc.get().then(function(snap) {
    if (!snap.exists) { callback(false); return; }
    const snapData = snap.data();
    if (!snapData.data || snapData.carIds) { callback(false); return; }
    try {
      const old = JSON.parse(snapData.data);
      if (!old.cars || old.cars.length === 0) { callback(false); return; }
      D = old;
      const carIds = old.cars.map(function(c){ return c.id; });
      const promises = old.cars.map(function(car) {
        const carData = {
          car: car,
          records: (old.records||[]).filter(function(r){ return r.carId===car.id; }),
          reminders: (old.reminders||[]).filter(function(r){ return r.carId===car.id; }),
          planned: (old.planned||[]).filter(function(p){ return p.carId===car.id; }),
        };
        return db.collection('shared_cars').doc(car.id).set({
          data: JSON.stringify(carData),
          updated: Date.now(),
          owners: [currentUser.uid],
          inviteCode: car.inviteCode || ''
        });
      });
      promises.push(db.collection('users').doc(currentUser.uid).set({
        carIds: carIds,
        stations: old.stations || [],
        updated: Date.now()
      }));
      Promise.all(promises).then(function(){
        setTimeout(function(){ oldDoc.update({data: null}); }, 2000);
        callback(true);
      }).catch(function(){ callback(false); });
    } catch(e) { callback(false); }
  }).catch(function(){ callback(false); });
}

function joinByCode(code, callback) {
  if (!currentUser) { callback('not_logged_in'); return; }
  const normalCode = code.trim().toUpperCase();
  db.collection('shared_cars').where('inviteCode','==',normalCode).get()
    .then(function(snap) {
      if (snap.empty) { callback('not_found'); return; }
      const carDoc = snap.docs[0];
      const carId = carDoc.id;
      const owners = carDoc.data().owners || [];
      if (owners.indexOf(currentUser.uid) !== -1) { callback('already_member'); return; }
      const currentOwners = carDoc.data().owners || [];
      if (currentOwners.indexOf(currentUser.uid) === -1) currentOwners.push(currentUser.uid);
      carDoc.ref.update({ owners: currentOwners }).then(function() {
        getUserDoc().get().then(function(uSnap) {
          const currentCarIds = uSnap.exists ? (uSnap.data().carIds || []) : [];
          if (currentCarIds.indexOf(carId) === -1) currentCarIds.push(carId);
          getUserDoc().set({ carIds: currentCarIds, updated: Date.now() }, {merge: true}).then(function() {
            callback('ok', carId);
          });
        });
      });
    }).catch(function(){ callback('error'); });
}

function setInviteCode(carId, code, callback) {
  if (!currentUser) return;
  const normalCode = code.trim().toUpperCase();
  if (!normalCode) { callback('empty'); return; }
  db.collection('shared_cars').where('inviteCode','==',normalCode).get()
    .then(function(snap) {
      if (!snap.empty && snap.docs[0].id !== carId) {
        callback('taken'); return;
      }
      getCarDoc(carId).update({inviteCode: normalCode}).then(function(){
        for (let i=0;i<D.cars.length;i++){
          if (D.cars[i].id===carId) { D.cars[i].inviteCode=normalCode; break; }
        }
        saveNow(D);
        callback('ok');
      });
    }).catch(function(){ callback('error'); });
}

function leaveCar(carId, callback) {
  if (!currentUser) return;
  getCarDoc(carId).get().then(function(snap) {
    let owners = snap.exists ? (snap.data().owners || []) : [];
    owners = owners.filter(function(o){ return o !== currentUser.uid; });
    getUserDoc().get().then(function(uSnap) {
      let carIds = uSnap.exists ? (uSnap.data().carIds || []) : [];
      carIds = carIds.filter(function(c){ return c !== carId; });
      Promise.all([
        getCarDoc(carId).update({ owners: owners }),
        getUserDoc().update({ carIds: carIds })
      ]).then(function(){ callback('ok'); }).catch(function(){ callback('error'); });
    });
  }).catch(function(){ callback('error'); });
}

let D = load();

const uid = function() { return Math.random().toString(36).slice(2,10); };
let view = 'home', selCarId = null, selRecId = null, toastTimer = null;
let weatherData = null, forecastData = null;

// Тексты из data-атрибутов
const T = {};
(function() {
  const el = document.getElementById('txt');
  if (!el) { console.error('Элемент #txt не найден!'); return; }
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (name.indexOf('data-') === 0) {
      T[name.slice(5)] = attrs[i].value;
    }
  }
})();

const DAYS = [T['days-su'], T['days-mo'], T['days-tu'], T['days-we'], T['days-th'], T['days-fr'], T['days-sa']];

const CATS = [
  {id:'maintenance', label:'TO / Obsluzhivanie', color:'#3B82F6', ru:''},
  {id:'repair',      label:'Remont',             color:'#EF4444', ru:''},
  {id:'tires',       label:'Shiny / Diski',      color:'#10B981', ru:''},
  {id:'fuel',        label:'Toplivo',             color:'#F59E0B', ru:''},
  {id:'insurance',   label:'Strakhovka',          color:'#8B5CF6', ru:''},
  {id:'other',       label:'Prochee',             color:'#6B7280', ru:''}
];

const catLabels = ['\u0422\u041e / \u041e\u0431\u0441\u043b\u0443\u0436\u0438\u0432\u0430\u043d\u0438\u0435', '\u0420\u0435\u043c\u043e\u043d\u0442', '\u0428\u0438\u043d\u044b / \u0414\u0438\u0441\u043a\u0438', '\u0422\u043e\u043f\u043b\u0438\u0432\u043e', '\u0421\u0442\u0440\u0430\u0445\u043e\u0432\u043a\u0430 / \u0414\u043e\u043a\u0438', '\u041f\u0440\u043e\u0447\u0435\u0435'];
for (let i = 0; i < CATS.length; i++) { CATS[i].ru = catLabels[i]; }

const EMOJIS = ['\ud83d\ude97','\ud83d\ude99','\ud83d\ude95','\ud83c\udfce','\ud83d\ude93','\ud83d\ude91','\ud83d\ude92','\ud83d\ude90','\ud83d\udefa','\ud83d\ude9a','\ud83d\ude8c','\ud83c\udfd4','\ud83d\udef5','\ud83d\ude9c','\ud83d\udebe'];

const REM_ICONS = ['\ud83d\udee2','\ud83d\uded1','\ud83d\udca8','\ud83e\uddca','\ud83d\udd0b','\u2699','\ud83d\udd04','\ud83d\udcdd'];
const REM_LABELS = ['\u0417\u0430\u043c\u0435\u043d\u0430 \u043c\u0430\u0441\u043b\u0430', '\u0422\u043e\u0440\u043c\u043e\u0437\u043d\u044b\u0435 \u043a\u043e\u043b\u043e\u0434\u043a\u0438', '\u0412\u043e\u0437\u0434\u0443\u0448\u043d\u044b\u0439 \u0444\u0438\u043b\u044c\u0442\u0440', '\u0410\u043d\u0442\u0438\u0444\u0440\u0438\u0437', '\u0410\u041a\u0411', '\u0420\u0435\u043c\u0435\u043d\u044c \u0413\u0420\u041c', '\u0421\u0435\u0437\u043e\u043d\u043d\u0430\u044f \u0440\u0435\u0437\u0438\u043d\u0430', '\u0421\u0432\u043e\u0451'];
const REM_KM    = [10000, 30000, 15000, null, null, 60000, null, null];
const REM_MO    = [12,    null,  12,    24,   36,   null,  6,    null];

const PRI_COLOR = {high:'#EF4444', medium:'#F59E0B', low:'#10B981'};
const PRI_LABEL = {
  high:   '\ud83d\udd34 \u0421\u0440\u043e\u0447\u043d\u043e',
  medium: '\ud83d\udfe1 \u0421\u043a\u043e\u0440\u043e',
  low:    '\ud83d\udfe2 \u041d\u0435 \u0433\u043e\u0440\u0438\u0442'
};
// ========== ХЕЛПЕРЫ ==========
function catById(id) { for (let i = 0; i < CATS.length; i++) { if (CATS[i].id === id) return CATS[i]; } return CATS[5]; }
function cRecs(id) { return D.records.filter(function(r){return r.carId===id;}).sort(function(a,b){return new Date(b.date)-new Date(a.date);}); }
function cRems(id) { return (D.reminders||[]).filter(function(r){return r.carId===id;}); }
function cPlan(id) { return (D.planned||[]).filter(function(p){return p.carId===id;}).sort(function(a,b){ const o={high:0,medium:1,low:2}; return (o[a.priority]||1)-(o[b.priority]||1); }); }
function cSpent(id) { return cRecs(id).reduce(function(s,r){return s+(parseFloat(r.cost)||0);},0); }
function lastTire(id) { const recs=cRecs(id); for(let i=0;i<recs.length;i++){if(recs[i].category==='tires'&&recs[i].tireType)return recs[i];} return null; }

function fmtNum(n) { return n ? parseInt(n).toLocaleString('ru') : '-'; }
function fmtMoney(n) { return n ? parseFloat(n).toLocaleString('ru')+' \u20BD' : '-'; }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('ru',{day:'numeric',month:'short',year:'numeric'}) : '-'; }
function fmtDateShort(s) { return s ? new Date(s).toLocaleDateString('ru',{day:'numeric',month:'long'}) : ''; }
function genQ(car,rec) { return ((rec.part||rec.title)+' '+car.make+' '+car.model+' '+car.year+(car.engine?' '+car.engine:'')).trim(); }
function wEmoji(m) { const map={Snow:'\u2744\ufe0f',Rain:'\ud83c\udf27',Drizzle:'\ud83c\udf26',Thunderstorm:'\u26c8',Clear:'\u2600\ufe0f',Clouds:'\u2601\ufe0f'}; return map[m]||'\ud83c\udf24'; }

function remPct(rem) {
  const now=new Date(); let pct=0;
  if ((rem.intervalType==='date'||rem.intervalType==='both') && rem.lastDate && rem.intervalMonths) {
    const l=new Date(rem.lastDate), n=new Date(l); n.setMonth(n.getMonth()+parseInt(rem.intervalMonths));
    pct = Math.max(pct, Math.min(Math.round(((now-l)/(n-l))*100), 110));
  }
  if ((rem.intervalType==='km'||rem.intervalType==='both') && rem.lastKm && rem.intervalKm && rem.currentKm)
    pct = Math.max(pct, Math.min(Math.round(((rem.currentKm-rem.lastKm)/rem.intervalKm)*100), 110));
  return pct;
}
function pColor(p) { return p>=100?'#EF4444':p>=75?'#F59E0B':'#10B981'; }
function daysLeft(rem) {
  if (!rem.lastDate||!rem.intervalMonths) return null;
  const n=new Date(rem.lastDate); n.setMonth(n.getMonth()+parseInt(rem.intervalMonths));
  return Math.round((n-new Date())/86400000);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){t.style.display='none';}, 2200);
}

function mk(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function(k) {
      if (k==='cls') e.className = attrs[k];
      else if (k==='css') e.style.cssText = attrs[k];
      else if (k==='txt') e.textContent = attrs[k];
      else if (k==='html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
  }
  if (children) {
    [].concat(children).forEach(function(c) {
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  return e;
}
function on(el, ev, fn) { el.addEventListener(ev, fn); return el; }

function render() {
  var preload = document.getElementById('preload');
  if (preload) preload.style.display = 'none';
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (view==='home') app.appendChild(buildHome());
  else if (view==='car') app.appendChild(buildCar());
  else if (view==='record') app.appendChild(buildRecord());
  else if (view==='history') app.appendChild(buildHistory());
  else if (view==='dashboard') app.appendChild(buildDashboard());
}

// ========== ГЛАВНЫЙ ЭКРАН ==========
function buildHome() {
  const div = mk('div');
  const hdr = mk('div',{cls:'hdr'});
  const logo = mk('div',{cls:'logo'});
  logo.appendChild(document.createTextNode('Car'));
  logo.appendChild(mk('span',{txt:'Diary'}));
  hdr.appendChild(logo);
  const userBar = mk('div',{cls:'user-bar'});
  if (currentUser) {
    userBar.appendChild(mk('div',{cls:'user-email', txt:currentUser.email}));
    const soBtn = mk('button',{cls:'signout-btn', txt:'\u0412\u044b\u0439\u0442\u0438'});
    on(soBtn,'click',function(){ auth.signOut(); });
    userBar.appendChild(soBtn);
  }
  hdr.appendChild(userBar);
  div.appendChild(hdr);

  if (D.cars.length === 0) {
    const empty = mk('div',{cls:'empty'});
    empty.appendChild(mk('div',{css:'font-size:48px;margin-bottom:16px', txt:'\ud83d\ude97'}));
    empty.appendChild(mk('h3',{txt:T['no-cars-title']}));
    empty.appendChild(mk('p',{txt:T['no-cars-desc']}));
    div.appendChild(empty);
  } else {
    const wrap = mk('div',{css:'padding:0 16px 110px'});
    const urgent = (D.reminders||[]).filter(function(r){return remPct(r)>=80;});
    if (urgent.length > 0) {
      wrap.appendChild(mk('div',{cls:'sec', txt:'\u26a0\ufe0f '+T['attention']}));
      urgent.slice(0,3).forEach(function(r) {
        const c = D.cars.filter(function(x){return x.id===r.carId;})[0];
        const pct = remPct(r);
        const a = mk('div',{cls:'alert '+(pct>=100?'alcr':'alwn')});
        a.appendChild(mk('span',{css:'font-size:22px', txt:r.icon||'\ud83d\udd14'}));
        const ab = mk('div');
        ab.appendChild(mk('div',{css:'font-size:13px;font-weight:600', txt:r.title}));
        ab.appendChild(mk('div',{css:'font-size:12px;color:#7A8099;margin-top:2px', txt:(c?c.make+' '+c.model:'')+(pct>=100?' \u00b7 '+T['overdue']:' \u00b7 '+pct+T['interval'])}));
        a.appendChild(ab);
        (function(carId){on(a,'click',function(){if(carId){selCarId=carId;view='car';render();}});})(c?c.id:null);
        wrap.appendChild(a);
      });
    }
    wrap.appendChild(mk('div',{cls:'sec', txt:T['my-cars']}));
    D.cars.forEach(function(c) {
      const card = mk('div',{cls:'card cardh', css:'display:flex;gap:16px;align-items:center'});
      card.appendChild(mk('div',{css:'width:56px;height:56px;border-radius:14px;background:#3B82F622;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0', txt:c.emoji||'\ud83d\ude97'}));
      const ci = mk('div',{css:'flex:1;min-width:0'});
      ci.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-weight:700;font-size:17px', txt:c.make+' '+c.model}));
      ci.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;margin-top:2px', txt:c.year+' \u00b7 '+(c.engine||'\u2014')}));
      card.appendChild(ci);
      const cr = mk('div',{css:'display:flex;flex-direction:column;align-items:flex-end;gap:4px'});
      cr.appendChild(mk('div',{css:'background:#1E2230;border-radius:8px;padding:4px 10px;font-size:12px;color:#7A8099', txt:cRecs(c.id).length+' '+T['records']}));
      const sp = cSpent(c.id);
      if (sp > 0) cr.appendChild(mk('div',{css:'font-size:12px;color:#C8FF00;font-family:Syne,sans-serif;font-weight:700', txt:sp.toLocaleString('ru')+' \u20BD'}));
      const pl = cPlan(c.id).length;
      if (pl > 0) cr.appendChild(mk('div',{css:'font-size:11px;color:#F59E0B', txt:'\ud83d\udccb '+pl+' '+T['plan-in']}));
      card.appendChild(cr);
      (function(id){on(card,'click',function(){selCarId=id;view='car';render();});})(c.id);
      wrap.appendChild(card);
    });
    div.appendChild(wrap);
  }
  const fabrow = mk('div',{cls:'fabrow'});
  const joinBtn = on(mk('button',{cls:'fab fabg', txt:'\ud83d\udd17 \u041f\u043e \u043a\u043e\u0434\u0443'}), 'click', function(){openJoinModal();});
  fabrow.appendChild(joinBtn);
  fabrow.appendChild(on(mk('button',{cls:'fab', txt:T['add-car']}), 'click', function(){openModal('car');}));
  div.appendChild(fabrow);
  return div;
}

// ========== ЭКРАН АВТОМОБИЛЯ ==========
function buildCar() {
  const car = D.cars.filter(function(c){return c.id===selCarId;})[0];
  if (!car) { view='home'; return buildHome(); }
  const recs=cRecs(car.id), rems=cRems(car.id), plans=cPlan(car.id), lt=lastTire(car.id);
  const div = mk('div');
  const hdr = mk('div',{cls:'hdr'});
  hdr.appendChild(on(mk('button',{cls:'ibtn', txt:'\u25c4'}), 'click', function(){view='home';selCarId=null;render();}));
  hdr.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:15px;font-weight:600', txt:car.make+' '+car.model}));
  hdr.appendChild(on(mk('button',{cls:'ibtn', txt:'\u270f\ufe0f'}), 'click', function(){openEditCarModal(car);}));
  div.appendChild(hdr);
  const wrap = mk('div',{cls:'wrap'});

  // Hero
  const hero = mk('div',{cls:'hero'});
  const htop = mk('div',{cls:'htop'});
  htop.appendChild(mk('div',{cls:'hava', txt:car.emoji||'\ud83d\ude97'}));
  const hi = mk('div');
  hi.appendChild(mk('div',{cls:'htitle', txt:car.make+' '+car.model}));
  hi.appendChild(mk('div',{cls:'hsub', txt:car.year+' \u00b7 '+(car.engine||T['engine-unknown'])}));
  if (car.vin) hi.appendChild(mk('div',{css:'font-size:12px;color:#7A8099;margin-top:4px;font-family:monospace;letter-spacing:1px', txt:car.vin}));
  htop.appendChild(hi); hero.appendChild(htop);
  const sts = mk('div',{cls:'stats'});
  [[recs.length,T['records']],[cSpent(car.id).toLocaleString('ru')+' \u20BD',T['spent']],[(car.mileage?parseInt(car.mileage).toLocaleString('ru')+' \u043a\u043c':'\u2014'),T['mileage-lbl']]].forEach(function(s){
    const st=mk('div',{cls:'stat'}); st.appendChild(mk('div',{cls:'statv',css:'font-size:14px',txt:''+s[0]})); st.appendChild(mk('div',{cls:'statk',txt:s[1]})); sts.appendChild(st);
  });
  hero.appendChild(sts);
  const dashBtn = on(mk('button',{css:'width:100%;margin-top:12px;padding:10px;border:1px solid rgba(200,255,0,.2);border-radius:12px;background:rgba(200,255,0,.06);color:#C8FF00;font-family:Syne,sans-serif;font-size:13px;font-weight:600;cursor:pointer',txt:'\ud83d\udcca \u0414\u0430\u0448\u0431\u043e\u0440\u0434 \u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432'}), 'click', function(){ view='dashboard'; render(); });
  hero.appendChild(dashBtn);
  wrap.appendChild(hero);

  // Tire widget
  wrap.appendChild(buildTireWidget(car,lt));

  // Reminders
  if (rems.length > 0) {
    wrap.appendChild(mk('div',{cls:'sec', txt:T['reminders-lbl']}));
    const rc = mk('div',{cls:'card rcard'});
    rems.forEach(function(r){rc.appendChild(buildRemItem(r));});
    wrap.appendChild(rc);
  }

  // Plans
  if (plans.length > 0) {
    wrap.appendChild(mk('div',{cls:'sec', txt:'\ud83d\udd27 '+T['plan-lbl']}));
    const pc = mk('div',{cls:'card rcard'});
    plans.forEach(function(p){pc.appendChild(buildPlanItem(p,car));});
    wrap.appendChild(pc);
  }

  // Recent records
  const now2 = new Date();
  const recentRecs = recs.filter(function(r){
    const d = new Date(r.date);
    return d.getFullYear()===now2.getFullYear() && d.getMonth()===now2.getMonth();
  });
  const monthName = now2.toLocaleDateString('ru',{month:'long',year:'numeric'});

  const secRow = mk('div',{css:'display:flex;align-items:center;justify-content:space-between;margin-top:24px;margin-bottom:10px'});
  secRow.appendChild(mk('div',{cls:'sec', css:'margin:0', txt:monthName}));
  if (recs.length > 0) {
    const histBtn = on(mk('button',{cls:'pbtn', css:'font-size:11px', txt:'\u0412\u0441\u044f \u0438\u0441\u0442\u043e\u0440\u0438\u044f \u2192'}), 'click', function(){ view='history'; render(); });
    secRow.appendChild(histBtn);
  }
  wrap.appendChild(secRow);

  if (recentRecs.length === 0) {
    const empty = mk('div',{cls:'card', css:'text-align:center;padding:32px'});
    empty.appendChild(mk('div',{css:'font-size:32px;margin-bottom:8px', txt:'\ud83d\udccb'}));
    empty.appendChild(mk('div',{css:'color:#7A8099;font-size:14px', txt:recs.length>0?'\u0412 \u044d\u0442\u043e\u043c \u043c\u0435\u0441\u044f\u0446\u0435 \u0437\u0430\u043f\u0438\u0441\u0435\u0439 \u043d\u0435\u0442':T['no-records-title']+'. '+T['no-records-desc']+'.' }));
    wrap.appendChild(empty);
  } else {
    const rcard = mk('div',{cls:'card rcard'});
    recentRecs.forEach(function(rec) { rcard.appendChild(buildRecRow(rec)); });
    const total = mk('div',{cls:'total'});
    total.appendChild(mk('div',{css:'font-size:13px;color:#7A8099', txt:T['total']}));
    total.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:20px;font-weight:800;color:#C8FF00', txt:cSpent(car.id).toLocaleString('ru')+' \u20BD'}));
    rcard.appendChild(total); wrap.appendChild(rcard);
  }

  const delBtn = on(mk('button',{cls:'btndel', css:'margin-top:16px', txt:'\ud83d\uddd1 '+T['del-car']}), 'click', function(){
    if (!confirm(T['del-confirm-car'])) return;
    D.cars=D.cars.filter(function(c){return c.id!==car.id;});
    D.records=D.records.filter(function(r){return r.carId!==car.id;});
    D.reminders=(D.reminders||[]).filter(function(r){return r.carId!==car.id;});
    D.planned=(D.planned||[]).filter(function(p){return p.carId!==car.id;});
    if (currentUser) leaveCar(car.id, function(){});
    saveNow(D); view='home'; render();
  });

  const shareBtn = on(mk('button',{css:'width:100%;margin-top:8px;padding:12px;border:1px solid rgba(200,255,0,.2);border-radius:12px;background:rgba(200,255,0,.06);color:#C8FF00;font-family:Syne,sans-serif;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px', txt:'\ud83d\udd17 \u041f\u043e\u0434\u0435\u043b\u0438\u0442\u044c\u0441\u044f \u2014 \u0434\u0430\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f'}), 'click', function(){
    openShareModal(car);
  });
  wrap.appendChild(shareBtn);
  wrap.appendChild(delBtn); div.appendChild(wrap);

  const fabrow = mk('div',{cls:'fabrow'});
  fabrow.appendChild(on(mk('button',{cls:'fab fabg', txt:'\ud83d\udd14 '+T['remind']}), 'click', function(){openModal('rem');}));
  fabrow.appendChild(on(mk('button',{cls:'fab fabp', txt:'\ud83d\udccb '+T['to-plan']}), 'click', function(){openModal('plan');}));
  fabrow.appendChild(on(mk('button',{cls:'fab', txt:'+ '+T['nav-record']}), 'click', function(){openModal('rec');}));
  div.appendChild(fabrow);
  return div;
}

// ========== ИСТОРИЯ ==========
function buildHistory() {
  const car = D.cars.filter(function(c){return c.id===selCarId;})[0];
  if (!car) { view='car'; return buildCar(); }
  const recs = cRecs(car.id);
  const div = mk('div');
  const hdr = mk('div',{cls:'hdr'});
  hdr.appendChild(on(mk('button',{cls:'ibtn',txt:'\u25c4'}),'click',function(){view='car';render();}));
  hdr.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:15px;font-weight:600',txt:'\u0412\u0441\u044f \u0438\u0441\u0442\u043e\u0440\u0438\u044f'}));
  hdr.appendChild(on(mk('button',{cls:'ibtn',txt:'\ud83d\udce4',title:'PDF'}),'click',function(){exportPDF(car);}));
  div.appendChild(hdr);
  const wrap = mk('div',{cls:'wrap'});

  if (recs.length === 0) {
    const empty = mk('div',{cls:'card', css:'text-align:center;padding:32px'});
    empty.appendChild(mk('div',{css:'font-size:32px;margin-bottom:8px',txt:'\ud83d\udccb'}));
    empty.appendChild(mk('div',{css:'color:#7A8099;font-size:14px',txt:T['no-records-title']}));
    wrap.appendChild(empty);
  } else {
    const groups = {};
    const groupOrder = [];
    recs.forEach(function(rec){
      const d = new Date(rec.date);
      const key = d.getFullYear()+'-'+d.getMonth();
      const label = d.toLocaleDateString('ru',{month:'long',year:'numeric'});
      if (!groups[key]) { groups[key]=[]; groupOrder.push({key:key,label:label}); }
      groups[key].push(rec);
    });
    groupOrder.forEach(function(g){
      wrap.appendChild(mk('div',{cls:'sec',txt:g.label}));
      const rcard = mk('div',{cls:'card rcard'});
      groups[g.key].forEach(function(rec){ rcard.appendChild(buildRecRow(rec)); });
      wrap.appendChild(rcard);
    });
    const total = mk('div',{cls:'card',css:'margin-top:12px;display:flex;justify-content:space-between;align-items:center'});
    total.appendChild(mk('div',{css:'font-size:13px;color:#7A8099',txt:'\u0412\u0441\u0435\u0433\u043e \u043f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e'}));
    total.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:22px;font-weight:800;color:#C8FF00',txt:cSpent(car.id).toLocaleString('ru')+' \u20BD'}));
    wrap.appendChild(total);
  }
  div.appendChild(wrap); return div;
}

// ========== ДАШБОРД ==========
function buildDashboard() {
  const car = D.cars.filter(function(c){return c.id===selCarId;})[0];
  if (!car) { view='car'; return buildCar(); }
  const recs = cRecs(car.id).filter(function(r){ return parseFloat(r.cost)>0; });

  const div = mk('div');
  const hdr = mk('div',{cls:'hdr'});
  hdr.appendChild(on(mk('button',{cls:'ibtn',txt:'\u25c4'}),'click',function(){view='car';render();}));
  hdr.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:15px;font-weight:600',txt:'\ud83d\udcca \u0414\u0430\u0448\u0431\u043e\u0440\u0434'}));
  hdr.appendChild(mk('div',{css:'width:42px'}));
  div.appendChild(hdr);

  const wrap = mk('div',{cls:'wrap'});
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  const totalAll = recs.reduce(function(s,r){return s+(parseFloat(r.cost)||0);},0);
  const totalYear = recs.filter(function(r){return new Date(r.date).getFullYear()===thisYear;}).reduce(function(s,r){return s+(parseFloat(r.cost)||0);},0);
  const totalMonth = recs.filter(function(r){const d=new Date(r.date);return d.getFullYear()===thisYear&&d.getMonth()===thisMonth;}).reduce(function(s,r){return s+(parseFloat(r.cost)||0);},0);

  const kpiCard = mk('div',{cls:'dash-card'});
  kpiCard.appendChild(mk('div',{cls:'dash-title',txt:'\u041e\u0431\u0449\u0430\u044f \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430'}));
  const kpiGrid = mk('div',{cls:'kpi-grid'});
  [
    [totalAll.toLocaleString('ru')+' \u20BD','\u0412\u0441\u0435\u0433\u043e \u043f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e','#C8FF00'],
    [totalYear.toLocaleString('ru')+' \u20BD','\u0412 '+thisYear+' \u0433\u043e\u0434\u0443','#3B82F6'],
    [totalMonth.toLocaleString('ru')+' \u20BD','\u0412 \u044d\u0442\u043e\u043c \u043c\u0435\u0441\u044f\u0446\u0435','#10B981'],
    [recs.length+' \u0448\u0442.','\u0417\u0430\u043f\u0438\u0441\u0435\u0439 \u0432\u0441\u0435\u0433\u043e','#8B5CF6']
  ].forEach(function(k){
    const kpi=mk('div',{cls:'kpi'});
    kpi.appendChild(mk('div',{cls:'kpi-val',css:'color:'+k[2],txt:k[0]}));
    kpi.appendChild(mk('div',{cls:'kpi-lbl',txt:k[1]}));
    kpiGrid.appendChild(kpi);
  });
  kpiCard.appendChild(kpiGrid);
  wrap.appendChild(kpiCard);

  const monthCard = mk('div',{cls:'dash-card'});
  monthCard.appendChild(mk('div',{cls:'dash-title',txt:'\u0420\u0430\u0441\u0445\u043e\u0434\u044b \u043f\u043e \u043c\u0435\u0441\u044f\u0446\u0430\u043c'}));
  const months = [];
  for (let i=11;i>=0;i--) {
    const d = new Date(thisYear, thisMonth-i, 1);
    months.push({year:d.getFullYear(),month:d.getMonth(),label:d.toLocaleDateString('ru',{month:'short'})});
  }
  const monthTotals = months.map(function(m){
    return recs.filter(function(r){const d=new Date(r.date);return d.getFullYear()===m.year&&d.getMonth()===m.month;}).reduce(function(s,r){return s+(parseFloat(r.cost)||0);},0);
  });
  const maxMonth = Math.max.apply(null,monthTotals)||1;

  const chart = mk('div',{cls:'month-chart'});
  months.forEach(function(m,i){
    const pct = (monthTotals[i]/maxMonth)*100;
    const isNow = m.year===thisYear&&m.month===thisMonth;
    const col = mk('div',{cls:'month-col'});
    const bar = mk('div',{cls:'month-bar',css:'height:'+Math.max(pct,2)+'%;background:'+(isNow?'#C8FF00':'#3B82F6')+(isNow?';box-shadow:0 0 8px rgba(200,255,0,.3)':'')});
    col.appendChild(bar);
    col.appendChild(mk('div',{cls:'month-name',txt:m.label}));
    if (monthTotals[i]>0) col.appendChild(mk('div',{cls:'month-val',css:'color:'+(isNow?'#C8FF00':'#7A8099'),txt:(monthTotals[i]/1000).toFixed(1)+'k'}));
    chart.appendChild(col);
  });
  monthCard.appendChild(chart);

  const nonZero = monthTotals.filter(function(v){return v>0;});
  if (nonZero.length>0) {
    const maxVal = Math.max.apply(null,nonZero);
    const maxIdx = monthTotals.indexOf(maxVal);
    const avgMonth = nonZero.reduce(function(a,b){return a+b;},0)/nonZero.length;
    const row2 = mk('div',{css:'display:flex;gap:10px;margin-top:4px'});
    [['\ud83d\udd25 \u0421\u0430\u043c\u044b\u0439 \u0434\u043e\u0440\u043e\u0433\u043e\u0439', months[maxIdx].label+': '+maxVal.toLocaleString('ru')+' \u20BD','#EF4444'],
     ['\u2300 \u0421\u0440\u0435\u0434\u043d\u0435\u0435 \u0432 \u043c\u0435\u0441\u044f\u0446',Math.round(avgMonth).toLocaleString('ru')+' \u20BD','#F59E0B']].forEach(function(s){
      const b=mk('div',{css:'flex:1;background:#1E2230;border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,.07)'});
      b.appendChild(mk('div',{css:'font-size:11px;color:#7A8099;margin-bottom:4px',txt:s[0]}));
      b.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:15px;font-weight:700;color:'+s[2],txt:s[1]}));
      row2.appendChild(b);
    });
    monthCard.appendChild(row2);
  }
  wrap.appendChild(monthCard);

  const catCard = mk('div',{cls:'dash-card'});
  catCard.appendChild(mk('div',{cls:'dash-title',txt:'\u0420\u0430\u0437\u0431\u0438\u0432\u043a\u0430 \u043f\u043e \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f\u043c'}));
  const catTotals = {};
  recs.forEach(function(r){
    const c=r.category||'other';
    catTotals[c]=(catTotals[c]||0)+(parseFloat(r.cost)||0);
  });
  const catSorted = Object.keys(catTotals).sort(function(a,b){return catTotals[b]-catTotals[a];});
  catSorted.forEach(function(cid){
    const cat=catById(cid), val=catTotals[cid];
    const row=mk('div',{cls:'bar-row'});
    row.appendChild(mk('div',{cls:'bar-label',txt:cat.ru}));
    const bw=mk('div',{cls:'bar-wrap'});
    bw.appendChild(mk('div',{cls:'bar-fill',css:'width:'+((val/totalAll)*100)+'%;background:'+cat.color}));
    row.appendChild(bw);
    row.appendChild(mk('div',{cls:'bar-val',css:'color:'+cat.color,txt:val.toLocaleString('ru')+' \u20BD'}));
    catCard.appendChild(row);
  });
  wrap.appendChild(catCard);

  const fuelRecs = cRecs(car.id).filter(function(r){return r.category==='fuel'&&r.liters&&r.mileage;}).sort(function(a,b){return new Date(a.date)-new Date(b.date);});
  if (fuelRecs.length>=2) {
    const fuelCard = mk('div',{cls:'dash-card'});
    fuelCard.appendChild(mk('div',{cls:'dash-title',txt:'\u26fd \u0422\u043e\u043f\u043b\u0438\u0432\u043e'}));
    const consumptions=[];
    for(let fi=1;fi<fuelRecs.length;fi++){
      const kmDiff=parseFloat(fuelRecs[fi].mileage)-parseFloat(fuelRecs[fi-1].mileage);
      const liters=parseFloat(fuelRecs[fi].liters);
      if(kmDiff>0&&liters>0) consumptions.push((liters/kmDiff)*100);
    }
    if(consumptions.length>0){
      const avgCons=consumptions.reduce(function(a,b){return a+b;},0)/consumptions.length;
      const totalLiters=fuelRecs.reduce(function(s,r){return s+(parseFloat(r.liters)||0);},0);
      const totalFuelCost=fuelRecs.reduce(function(s,r){return s+(parseFloat(r.cost)||0);},0);
      const fg=mk('div',{cls:'kpi-grid'});
      [[avgCons.toFixed(1)+' \u043b/100\u043a\u043c','\u0421\u0440\u0435\u0434\u043d\u0438\u0439 \u0440\u0430\u0441\u0445\u043e\u0434','#F59E0B'],
       [totalLiters.toFixed(0)+' \u043b','\u0412\u0441\u0435\u0433\u043e \u0437\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e','#10B981'],
       [fuelRecs.length+' \u0437\u0430\u043f\u0440.','\u0417\u0430\u043f\u0440\u0430\u0432\u043e\u043a','#3B82F6'],
       [totalFuelCost.toLocaleString('ru')+' \u20BD','\u041f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e \u043d\u0430 \u0442\u043e\u043f\u043b\u0438\u0432\u043e','#EF4444']
      ].forEach(function(k){
        const kpi=mk('div',{cls:'kpi'}); kpi.appendChild(mk('div',{cls:'kpi-val',css:'color:'+k[2],txt:k[0]})); kpi.appendChild(mk('div',{cls:'kpi-lbl',txt:k[1]})); fg.appendChild(kpi);
      });
      fuelCard.appendChild(fg);
      wrap.appendChild(fuelCard);
    }
  }

  div.appendChild(wrap);
  return div;
}
// ========== ЗАПИСИ И МОДАЛКИ ==========
function buildRecRow(rec) {
  const cat = catById(rec.category);
  const row = mk('div',{cls:'ri'});
  row.appendChild(mk('div',{cls:'rdot', css:'background:'+cat.color}));
  const rb = mk('div',{cls:'rb'});
  rb.appendChild(mk('div',{cls:'rt', txt:rec.title}));
  if (rec.fuelType) {
    let fuelMeta = '';
    if (rec.liters) fuelMeta += rec.liters+' \u043b';
    if (rec.pricePerLiter) fuelMeta += ' \u00b7 '+rec.pricePerLiter+' \u20BD/\u043b';
    if (rec.station) fuelMeta += ' \u00b7 '+rec.station;
    if (fuelMeta) rb.appendChild(mk('div',{css:'font-size:12px;color:#F59E0B;margin-top:2px', txt:fuelMeta}));
  }
  if (rec.part) rb.appendChild(mk('div',{css:'font-size:12px;color:#7A8099;margin-top:2px', txt:T['part-lbl']+' '+rec.part}));
  if (rec.expiry) rb.appendChild(mk('div',{css:'font-size:12px;color:#8B5CF6;margin-top:2px', txt:'\u0414\u043e: '+fmtDate(rec.expiry)}));
  const meta = mk('div',{cls:'rm'});
  meta.appendChild(mk('span',{txt:fmtDate(rec.date)}));
  if (rec.mileage) meta.appendChild(mk('span',{txt:fmtNum(rec.mileage)+' \u043a\u043c'}));
  meta.appendChild(mk('span',{cls:'pill', css:'background:'+cat.color+'22;color:'+cat.color, txt:cat.ru}));
  rb.appendChild(meta); row.appendChild(rb);
  if (rec.cost) row.appendChild(mk('div',{cls:'rc', txt:parseFloat(rec.cost).toLocaleString('ru')+' \u20BD'}));
  (function(id){on(row,'click',function(){selRecId=id;view='record';render();});})(rec.id);
  return row;
}

function buildRecord() {
  const car=D.cars.filter(function(c){return c.id===selCarId;})[0];
  const rec=D.records.filter(function(r){return r.id===selRecId;})[0];
  if (!car||!rec) { view='car'; return buildCar(); }
  const cat=catById(rec.category), q=genQ(car,rec);
  const div=mk('div');
  const hdr=mk('div',{cls:'hdr'});
  hdr.appendChild(on(mk('button',{cls:'ibtn',txt:'\u25c4'}),'click',function(){view='car';render();}));
  hdr.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:15px;font-weight:600',txt:T['nav-record']}));
  const editBtn=on(mk('button',{cls:'ibtn',txt:'\u270f\ufe0f'}),'click',function(){openEditModal(rec);});
  hdr.appendChild(editBtn);
  div.appendChild(hdr);
  const wrap=mk('div',{cls:'wrap'});
  const card=mk('div',{cls:'card',css:'margin-bottom:14px'});
  const top=mk('div',{css:'display:flex;gap:12px;align-items:flex-start;margin-bottom:16px'});
  top.appendChild(mk('div',{css:'width:44px;height:44px;border-radius:12px;background:'+cat.color+'22;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px',txt:'\ud83d\udd27'}));
  const ti=mk('div');
  ti.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:18px;font-weight:700',txt:rec.title}));
  if (rec.tireType) { const tl2=rec.tireType==='summer'?T['tire-summer']:rec.tireType==='winter'?T['tire-winter']:T['tire-all']; ti.appendChild(mk('div',{css:'font-size:13px;color:#10B981;margin-top:4px',txt:tl2})); }
  ti.appendChild(mk('span',{cls:'pill',css:'background:'+cat.color+'22;color:'+cat.color+';margin-top:6px;display:inline-flex',txt:cat.ru}));
  top.appendChild(ti); card.appendChild(top);
  const grid=mk('div',{css:'display:grid;grid-template-columns:1fr 1fr;gap:10px'});
  [[T['date-lbl'],fmtDate(rec.date)],[T['mileage-f'],rec.mileage?fmtNum(rec.mileage)+' \u043a\u043c':'\u2014'],[T['cost-lbl'],fmtMoney(rec.cost)],[T['part-f'],rec.part||'\u2014']].forEach(function(s){
    const st=mk('div',{cls:'stat'}); st.appendChild(mk('div',{cls:'statk',txt:s[0]})); st.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-weight:600;font-size:13px;margin-top:4px',txt:s[1]})); grid.appendChild(st);
  });
  if (rec.fuelType) {
    const fg=mk('div',{css:'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px'});
    if(rec.liters){const s=mk('div',{cls:'stat'});s.appendChild(mk('div',{cls:'statk',txt:'\u041b\u0438\u0442\u0440\u043e\u0432'}));s.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-weight:600;font-size:13px;margin-top:4px',txt:rec.liters+' \u043b'}));fg.appendChild(s);}
    if(rec.pricePerLiter){const s2=mk('div',{cls:'stat'});s2.appendChild(mk('div',{cls:'statk',txt:'\u0426\u0435\u043d\u0430/\u043b'}));s2.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-weight:600;font-size:13px;margin-top:4px',txt:rec.pricePerLiter+' \u20BD'}));fg.appendChild(s2);}
    if(rec.station){const s3=mk('div',{cls:'stat',css:'grid-column:1/-1'});s3.appendChild(mk('div',{cls:'statk',txt:'\u0417\u0430\u043f\u0440\u0430\u0432\u043a\u0430'}));s3.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-weight:600;font-size:13px;margin-top:4px',txt:rec.station}));fg.appendChild(s3);}
    card.appendChild(fg);
  }
  if(rec.expiry){const expSt=mk('div',{cls:'stat',css:'margin-top:10px'});expSt.appendChild(mk('div',{cls:'statk',txt:'\u0414\u0430\u0442\u0430 \u043e\u043a\u043e\u043d\u0447\u0430\u043d\u0438\u044f'}));expSt.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-weight:600;font-size:13px;margin-top:4px;color:#8B5CF6',txt:fmtDate(rec.expiry)}));card.appendChild(expSt);}
  card.appendChild(grid);
  if (rec.notes) card.appendChild(mk('div',{css:'margin-top:14px;padding:14px;background:#1E2230;border-radius:12px;font-size:14px;line-height:1.5;color:#7A8099',txt:rec.notes}));
  wrap.appendChild(card);

  // Photos
  const photoSection = mk('div',{cls:'card',css:'margin-bottom:14px'});
  photoSection.appendChild(mk('div',{css:'font-size:13px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px',txt:'\ud83d\udcf8 \u0424\u043e\u0442\u043e'}));
  const photoGrid = mk('div',{cls:'photo-grid'});
  const photos = rec.photos || [];
  photos.forEach(function(photo, idx) {
    const img = mk('img',{cls:'photo-thumb', src:photo, loading:'lazy'});
    on(img,'click',function(){ openLightbox(photos, idx, rec); });
    photoGrid.appendChild(img);
  });
  const addPhotoBtn = mk('div',{cls:'photo-add'});
  addPhotoBtn.appendChild(mk('span',{css:'font-size:24px',txt:'+'}));
  addPhotoBtn.appendChild(mk('span',{txt:'\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0444\u043e\u0442\u043e'}));
  const fileInput = mk('input'); fileInput.type='file'; fileInput.accept='image/*'; fileInput.multiple=true; fileInput.style.display='none';
  on(addPhotoBtn,'click',function(){ fileInput.click(); });
  on(fileInput,'change',function(){
    const files = Array.from(fileInput.files);
    if (!files.length) return;
    addPhotoBtn.innerHTML=''; addPhotoBtn.appendChild(mk('span',{txt:'\u0421\u0436\u0438\u043c\u0430\u0435\u043c...'}));
    const promises = files.map(function(f){ return compressPhoto(f); });
    Promise.all(promises).then(function(results){
      for(let i=0;i<D.records.length;i++){
        if(D.records[i].id===rec.id){
          if(!D.records[i].photos) D.records[i].photos=[];
          D.records[i].photos = D.records[i].photos.concat(results);
          break;
        }
      }
      saveNow(D); showToast('\u0424\u043e\u0442\u043e \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u2713'); render();
    }).catch(function(){ showToast('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438'); });
  });
  photoGrid.appendChild(addPhotoBtn);
  photoSection.appendChild(photoGrid);
  photoSection.appendChild(fileInput);
  wrap.appendChild(photoSection);

  const qbox=mk('div',{cls:'qbox'});
  qbox.appendChild(mk('div',{cls:'qlbl',txt:T['search-lbl']}));
  qbox.appendChild(mk('div',{cls:'qtxt',txt:q}));
  const ql=mk('div',{cls:'qlinks'});
  ql.appendChild(on(mk('button',{cls:'copybtn',txt:T['copy-btn']}),'click',function(){navigator.clipboard.writeText(q).then(function(){showToast(T['copied']);});}));
  [['Avito','https://www.avito.ru/rossiya?q='],['Exist','https://exist.ru/search/?q='],['Drom','https://www.drom.ru/catalog/?q='],['Yandex','https://yandex.ru/search/?text=']].forEach(function(s){
    ql.appendChild(mk('a',{cls:'qlink',txt:s[0],href:s[1]+encodeURIComponent(q),target:'_blank'}));
  });
  qbox.appendChild(ql); wrap.appendChild(qbox);
  wrap.appendChild(on(mk('button',{cls:'btndel',txt:'\ud83d\uddd1 '+T['del-rec']}),'click',function(){
    if (!confirm(T['del-confirm-rec'])) return;
    D.records=D.records.filter(function(r){return r.id!==rec.id;}); saveNow(D); view='car'; render();
  }));
  div.appendChild(wrap); return div;
}

// ========== МОДАЛЬНЫЕ ОКНА ==========
let currentModal = null;
function openModal(type) {
  closeModal();
  const ov = on(mk('div',{cls:'overlay'}),'click',function(e){if(e.target===ov)closeModal();});
  const modal = mk('div',{cls:'modal'});
  if (type==='car') buildCarForm(modal);
  else if (type==='rec') buildRecForm(modal);
  else if (type==='rem') buildRemForm(modal,1,null);
  else if (type==='plan') buildPlanForm(modal);
  ov.appendChild(modal); document.body.appendChild(ov); currentModal=ov;
}
function closeModal() { if (currentModal) { currentModal.remove(); currentModal=null; } }

function mHdr(modal, title, showBack, backFn) {
  const h=mk('div',{cls:'mhdr'});
  const left=mk('div',{css:'display:flex;align-items:center;gap:10px'});
  if (showBack) left.appendChild(on(mk('button',{cls:'ibtn',css:'width:32px;height:32px;border-radius:8px',txt:'\u25c4'}),'click',backFn));
  left.appendChild(mk('div',{cls:'mtitle',txt:title}));
  h.appendChild(left);
  h.appendChild(on(mk('button',{cls:'ibtn',txt:'\u2715'}),'click',closeModal));
  modal.appendChild(h);
}
function addField(modal, label, input) {
  const f=mk('div',{cls:'field'}); f.appendChild(mk('label',{txt:label})); f.appendChild(input); modal.appendChild(f); return input;
}
function mkInp(type, ph, val) {
  const i = mk(type==='textarea'?'textarea':(type==='select'?'select':'input'),{cls:'inp'});
  if (type!=='textarea'&&type!=='select') i.type=type||'text';
  if (ph) i.placeholder=ph;
  if (val!==undefined&&val!==null) i.value=val;
  return i;
}

function openEditModal(rec) {
  closeModal();
  const ov = on(mk('div',{cls:'overlay'}),'click',function(e){if(e.target===ov)closeModal();});
  const modal = mk('div',{cls:'modal'});
  mHdr(modal,'\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435',false,null);

  const titleInp = mkInp('text','',rec.title||''); addField(modal,'\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435',titleInp);
  const row = mk('div',{cls:'row2'});
  const dateInp = mkInp('date','',rec.date||''); const df=mk('div',{cls:'field'}); df.appendChild(mk('label',{txt:T['date-inp']})); df.appendChild(dateInp); row.appendChild(df);
  const milInp = mkInp('number','',rec.mileage||''); const mf=mk('div',{cls:'field'}); mf.appendChild(mk('label',{txt:T['mil-inp']})); mf.appendChild(milInp); row.appendChild(mf);
  modal.appendChild(row);
  const costInp = mkInp('number','',rec.cost||''); addField(modal,T['cost-inp'],costInp);
  const partInp = mkInp('text','',rec.part||''); addField(modal,T['part-f'],partInp);

  if (rec.category==='fuel') {
    const priceInp = mkInp('number','',rec.pricePerLiter||''); addField(modal,'\u0426\u0435\u043d\u0430/\u043b (\u20BD)',priceInp);
    const litersInp = mkInp('number','',rec.liters||''); addField(modal,'\u041b\u0438\u0442\u0440\u043e\u0432',litersInp);
    const stationInp = mkInp('text','',rec.station||''); addField(modal,'\u0417\u0430\u043f\u0440\u0430\u0432\u043a\u0430',stationInp);
  }
  if (rec.category==='insurance') {
    const expiryInp = mkInp('date','',rec.expiry||''); addField(modal,'\u0414\u0430\u0442\u0430 \u043e\u043a\u043e\u043d\u0447\u0430\u043d\u0438\u044f',expiryInp);
  }
  const notesInp = mkInp('textarea','',rec.notes||''); addField(modal,T['notes-inp'],notesInp);

  const saveBtn = on(mk('button',{cls:'btnok',txt:'\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f'}), 'click', function(){
    for (let i=0;i<D.records.length;i++) {
      if (D.records[i].id===rec.id) {
        D.records[i].title = titleInp.value.trim()||rec.title;
        D.records[i].date = dateInp.value||rec.date;
        D.records[i].mileage = milInp.value;
        if (milInp.value) {
          for (let ci=0;ci<D.cars.length;ci++) {
            if (D.cars[ci].id===selCarId) {
              const nm=parseInt(milInp.value), cm=parseInt(D.cars[ci].mileage)||0;
              if (nm>cm) D.cars[ci].mileage=milInp.value;
              break;
            }
          }
        }
        D.records[i].cost = costInp.value;
        D.records[i].part = partInp.value.trim();
        D.records[i].notes = notesInp.value.trim();
        if (rec.category==='fuel') {
          D.records[i].pricePerLiter = priceInp.value;
          D.records[i].liters = litersInp.value;
          D.records[i].station = stationInp.value.trim();
        }
        if (rec.category==='insurance') {
          D.records[i].expiry = expiryInp.value;
        }
        break;
      }
    }
    save(D); closeModal(); showToast('\u0417\u0430\u043f\u0438\u0441\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430 \u2713'); render();
  });
  modal.appendChild(saveBtn);
  ov.appendChild(modal); document.body.appendChild(ov); currentModal=ov;
}

function openEditCarModal(car) {
  closeModal();
  const ov = on(mk('div',{cls:'overlay'}),'click',function(e){if(e.target===ov)closeModal();});
  const modal = mk('div',{cls:'modal'});
  mHdr(modal,'\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0430\u0432\u0442\u043e',false,null);

  let selEmoji = car.emoji || EMOJIS[0];
  const emDiv=mk('div',{cls:'field'}); emDiv.appendChild(mk('label',{txt:T['icon-lbl']}));
  const eg=mk('div',{cls:'emojis'});
  EMOJIS.forEach(function(e) {
    const b=mk('div',{cls:'emj '+(e===selEmoji?'emjon':''), txt:e});
    on(b,'click',function(){ eg.querySelectorAll('.emj').forEach(function(x){x.className='emj';}); b.className='emj emjon'; selEmoji=e; });
    eg.appendChild(b);
  });
  emDiv.appendChild(eg); modal.appendChild(emDiv);

  const row=mk('div',{cls:'row2'});
  const make=mkInp('text','',car.make||''); const mf=mk('div',{cls:'field'}); mf.appendChild(mk('label',{txt:T['make-lbl']+' *'})); mf.appendChild(make); row.appendChild(mf);
  const model=mkInp('text','',car.model||''); const mof=mk('div',{cls:'field'}); mof.appendChild(mk('label',{txt:T['model-lbl']+' *'})); mof.appendChild(model); row.appendChild(mof);
  modal.appendChild(row);
  const row2=mk('div',{cls:'row2'});
  const year=mkInp('number','',car.year||new Date().getFullYear()); const yf=mk('div',{cls:'field'}); yf.appendChild(mk('label',{txt:T['year-lbl']})); yf.appendChild(year); row2.appendChild(yf);
  const engine=mkInp('text','',car.engine||''); const ef=mk('div',{cls:'field'}); ef.appendChild(mk('label',{txt:T['engine-lbl']})); ef.appendChild(engine); row2.appendChild(ef);
  modal.appendChild(row2);
  const vin=mkInp('text','',car.vin||''); vin.style.fontFamily='monospace'; vin.style.letterSpacing='1px'; addField(modal,T['vin-lbl'],vin);
  const mil=mkInp('number','',car.mileage||''); addField(modal,T['mil-lbl'],mil);

  const regDiv=mk('div',{cls:'field'});
  regDiv.appendChild(mk('label',{txt:'\u0420\u0435\u0433\u0438\u043e\u043d (\u0434\u043b\u044f \u0440\u0435\u0437\u0438\u043d\u044b)'}));
  const regSel=mk('select',{cls:'inp'});
  REGIONS.forEach(function(r){
    const opt=mk('option',{txt:r.label}); opt.value=r.id;
    if (r.id===(car.region||'moscow')) opt.selected=true;
    regSel.appendChild(opt);
  });
  regDiv.appendChild(regSel); modal.appendChild(regDiv);

  const saveBtn = on(mk('button',{cls:'btnok',txt:'\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c'}),'click',function(){
    if (!make.value.trim()||!model.value.trim()) { showToast(T['need-make']); return; }
    for (let i=0;i<D.cars.length;i++) {
      if (D.cars[i].id===car.id) {
        D.cars[i].make = make.value.trim();
        D.cars[i].model = model.value.trim();
        D.cars[i].year = year.value;
        D.cars[i].engine = engine.value.trim();
        D.cars[i].vin = vin.value.trim();
        D.cars[i].mileage = mil.value;
        D.cars[i].emoji = selEmoji;
        D.cars[i].region = regSel.value;
        break;
      }
    }
    save(D); closeModal(); showToast('\u0410\u0432\u0442\u043e \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d \u2713'); render();
  });
  modal.appendChild(saveBtn);
  ov.appendChild(modal); document.body.appendChild(ov); currentModal=ov;
}

function buildCarForm(modal) {
  mHdr(modal, T['new-car'], false, null);
  let selEmoji = EMOJIS[0];
  const emDiv=mk('div',{cls:'field'}); emDiv.appendChild(mk('label',{txt:T['icon-lbl']}));
  const eg=mk('div',{cls:'emojis'});
  EMOJIS.forEach(function(e,idx) {
    const b=mk('div',{cls:'emj '+(idx===0?'emjon':''), txt:e});
    on(b,'click',function(){ eg.querySelectorAll('.emj').forEach(function(x){x.className='emj';}); b.className='emj emjon'; selEmoji=e; });
    eg.appendChild(b);
  });
  emDiv.appendChild(eg); modal.appendChild(emDiv);
  const row=mk('div',{cls:'row2'});
  const make=mkInp('text','Toyota'); const mf=mk('div',{cls:'field'}); mf.appendChild(mk('label',{txt:T['make-lbl']+' *'})); mf.appendChild(make); row.appendChild(mf);
  const model=mkInp('text','Camry'); const mof=mk('div',{cls:'field'}); mof.appendChild(mk('label',{txt:T['model-lbl']+' *'})); mof.appendChild(model); row.appendChild(mof);
  modal.appendChild(row);
  const row2=mk('div',{cls:'row2'});
  const year=mkInp('number','2020',new Date().getFullYear()); const yf=mk('div',{cls:'field'}); yf.appendChild(mk('label',{txt:T['year-lbl']})); yf.appendChild(year); row2.appendChild(yf);
  const engine=mkInp('text','2.5 2AR-FE'); const ef=mk('div',{cls:'field'}); ef.appendChild(mk('label',{txt:T['engine-lbl']})); ef.appendChild(engine); row2.appendChild(ef);
  modal.appendChild(row2);
  const vin=mkInp('text','JT...'); vin.style.fontFamily='monospace'; vin.style.letterSpacing='1px'; addField(modal,T['vin-lbl'],vin);
  const mil=mkInp('number','85000'); addField(modal,T['mil-lbl'],mil);
  const regDiv2=mk('div',{cls:'field'}); regDiv2.appendChild(mk('label',{txt:'\u0420\u0435\u0433\u0438\u043e\u043d (\u0434\u043b\u044f \u0440\u0435\u0437\u0438\u043d\u044b)'}));
  const regSel2=mk('select',{cls:'inp'});
  REGIONS.forEach(function(r){ const opt=mk('option',{txt:r.label}); opt.value=r.id; regSel2.appendChild(opt); });
  regDiv2.appendChild(regSel2); modal.appendChild(regDiv2);
  on(addField(modal,'',mk('button',{cls:'btnok',txt:T['add-car-btn']})),'click',function(){
    if (!make.value.trim()||!model.value.trim()) { showToast(T['need-make']); return; }
    D.cars.push({id:uid(),make:make.value.trim(),model:model.value.trim(),year:year.value,engine:engine.value.trim(),vin:vin.value.trim(),mileage:mil.value,emoji:selEmoji,region:regSel2.value,createdAt:new Date().toISOString()});
    saveNow(D); closeModal(); showToast(T['added-car']); render();
  });
}

function buildRecForm(modal) {
  const car = D.cars.filter(function(c){return c.id===selCarId;})[0];
  mHdr(modal, T['new-record'], false, null);

  let selCat = 'maintenance';
  const catDiv = mk('div',{cls:'field'});
  catDiv.appendChild(mk('label',{txt:T['category-lbl']}));
  const cg = mk('div',{cls:'cats'});
  const dynForm = mk('div');

  function commonFields() {
    const row = mk('div',{cls:'row2'});
    const date = mkInp('date','',new Date().toISOString().slice(0,10));
    const df = mk('div',{cls:'field'}); df.appendChild(mk('label',{txt:T['date-inp']})); df.appendChild(date); row.appendChild(df);
    const mili = mkInp('number','',car?car.mileage:'');
    const mf = mk('div',{cls:'field'}); mf.appendChild(mk('label',{txt:T['mil-inp']})); mf.appendChild(mili); row.appendChild(mf);
    return {row:row, date:date, mili:mili};
  }

  function chkRow(label) {
    const wrap = mk('div',{css:'display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)'});
    const left = mk('div',{css:'display:flex;align-items:center;gap:10px'});
    const chk = mk('input'); chk.type='checkbox';
    chk.style.cssText='width:18px;height:18px;cursor:pointer;accent-color:#C8FF00';
    const lbl = mk('span',{css:'font-size:14px',txt:label});
    left.appendChild(chk); left.appendChild(lbl);
    const costInp = mkInp('number','');
    costInp.style.cssText='width:110px;padding:7px 10px;font-size:13px;display:none';
    costInp.placeholder='\u20BD';
    wrap.appendChild(left); wrap.appendChild(costInp);
    chk.addEventListener('change',function(){ costInp.style.display=chk.checked?'block':'none'; });
    return {wrap:wrap, chk:chk, cost:costInp};
  }

  const formData = {};
  function buildDyn(cat) {
    dynForm.innerHTML='';
    formData.cat = cat;

    if (cat==='maintenance') {
      const items = [
        ['\u041c\u0430\u0441\u043b\u043e','oil'],
        ['\u041c\u0430\u0441\u043b\u044f\u043d\u044b\u0439 \u0444\u0438\u043b\u044c\u0442\u0440','oil_filter'],
        ['\u0412\u043e\u0437\u0434\u0443\u0448\u043d\u044b\u0439 \u0444\u0438\u043b\u044c\u0442\u0440','air_filter'],
        ['\u0421\u0430\u043b\u043e\u043d\u043d\u044b\u0439 \u0444\u0438\u043b\u044c\u0442\u0440','cabin_filter'],
        ['\u0420\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0438','consumables']
      ];
      const chkBox = mk('div',{cls:'card',css:'padding:12px 16px;margin-bottom:12px'});
      formData.chks = [];
      items.forEach(function(it) {
        const r = chkRow(it[0]); r.key=it[1]; formData.chks.push(r); chkBox.appendChild(r.wrap);
      });
      dynForm.appendChild(chkBox);
      const cf = commonFields(); dynForm.appendChild(cf.row); formData.date=cf.date; formData.mili=cf.mili;
      const notes = mkInp('textarea',''); addField(dynForm,T['notes-inp'],notes); formData.notes=notes;

    } else if (cat==='fuel') {
      const ftWrap = mk('div',{cls:'field'});
      ftWrap.appendChild(mk('label',{txt:'\u0422\u0438\u043f \u0442\u043e\u043f\u043b\u0438\u0432\u0430'}));
      const ftRow = mk('div',{css:'display:flex;gap:8px;margin-bottom:4px'});
      let selFuelType = 'benzin'; const ftBtns = [];
      const octaneWrap = mk('div',{cls:'field'});

      function buildOctane(ft) {
        octaneWrap.innerHTML='';
        if (ft !== 'benzin') return;
        octaneWrap.appendChild(mk('label',{txt:'\u041e\u043a\u0442\u0430\u043d\u043e\u0432\u043e\u0435 \u0447\u0438\u0441\u043b\u043e'}));
        const oRow = mk('div',{css:'display:flex;gap:8px;flex-wrap:wrap'});
        let selOct = '95'; const oBtns = [];
        [['92','92'],['95','95'],['95+','95+'],['100','100']].forEach(function(o){
          const b = mk('button',{cls:'pbtn '+(o[0]==='95'?'pbtnon':''), txt:o[1]});
          on(b,'click',function(){ oBtns.forEach(function(x){x.className='pbtn';}); b.className='pbtn pbtnon'; selOct=o[0]; formData.octane=selOct; });
          oBtns.push(b); oRow.appendChild(b);
        });
        formData.octane = '95';
        octaneWrap.appendChild(oRow);
      }

      ['\u0411\u0435\u043d\u0437\u0438\u043d','\u0414\u0438\u0437\u0435\u043b\u044c','\u041c\u0435\u0442\u0430\u043d'].forEach(function(lbl,idx){
        const id = ['benzin','dizel','metan'][idx];
        const b = mk('button',{cls:'pbtn '+(id==='benzin'?'pbtnon':''), txt:lbl});
        on(b,'click',function(){
          ftBtns.forEach(function(x){x.className='pbtn';}); b.className='pbtn pbtnon';
          selFuelType=id; formData.selFuelType=id; buildOctane(id);
        });
        ftBtns.push(b); ftRow.appendChild(b);
      });
      formData.selFuelType='benzin';
      ftWrap.appendChild(ftRow); dynForm.appendChild(ftWrap);
      dynForm.appendChild(octaneWrap);
      buildOctane('benzin');

      const savedStations = D.stations || [];
      const stField = mk('div',{cls:'field'});
      stField.appendChild(mk('label',{txt:'\u0417\u0430\u043f\u0440\u0430\u0432\u043a\u0430'}));
      const stWrap = mk('div',{css:'position:relative'});
      const stInp = mkInp('text',''); stInp.autocomplete='off';
      const dropdown = mk('div',{css:'display:none;position:absolute;top:100%;left:0;right:0;background:#1E2230;border:1px solid rgba(255,255,255,.07);border-radius:12px;z-index:50;overflow:hidden;margin-top:4px'});

      function updateDropdown() {
        const val = stInp.value.trim().toLowerCase();
        dropdown.innerHTML='';
        const matches = savedStations.filter(function(s){ return s.toLowerCase().indexOf(val)===0 && s!==stInp.value; });
        if (matches.length===0 || val==='') { dropdown.style.display='none'; return; }
        matches.slice(0,5).forEach(function(s){
          const item = mk('div',{css:'padding:11px 14px;font-size:14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.07)',txt:s});
          on(item,'click',function(){ stInp.value=s; dropdown.style.display='none'; });
          dropdown.appendChild(item);
        });
        dropdown.style.display='block';
      }
      on(stInp,'input',updateDropdown);
      on(stInp,'blur',function(){ setTimeout(function(){ dropdown.style.display='none'; },200); });
      stWrap.appendChild(stInp); stWrap.appendChild(dropdown);
      stField.appendChild(stWrap); dynForm.appendChild(stField);
      formData.stInp=stInp; formData.savedStations=savedStations;

      const priceInp = mkInp('number',''); priceInp.placeholder='0.00'; priceInp.step='0.01';
      const litersInp = mkInp('number',''); litersInp.placeholder='0';
      const totalInp = mkInp('number',''); totalInp.placeholder='0';
      addField(dynForm,'\u0426\u0435\u043d\u0430 \u0437\u0430 \u043b\u0438\u0442\u0440 (\u20BD)',priceInp);
      addField(dynForm,'\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e (\u043b)',litersInp);
      addField(dynForm,'\u0418\u0442\u043e\u0433\u043e (\u20BD)',totalInp);
      formData.priceInp=priceInp; formData.litersInp=litersInp; formData.totalInp=totalInp;

      function calcFuel(changed) {
        const p = parseFloat(priceInp.value);
        const l = parseFloat(litersInp.value);
        const t = parseFloat(totalInp.value);
        if (changed==='price' && !isNaN(p) && !isNaN(l) && l>0) { totalInp.value = (p*l).toFixed(0); }
        else if (changed==='price' && !isNaN(p) && !isNaN(t) && t>0) { litersInp.value = (t/p).toFixed(2); }
        else if (changed==='liters' && !isNaN(l) && !isNaN(p) && p>0) { totalInp.value = (p*l).toFixed(0); }
        else if (changed==='liters' && !isNaN(l) && !isNaN(t) && t>0) { priceInp.value = (t/l).toFixed(2); }
        else if (changed==='total' && !isNaN(t) && !isNaN(p) && p>0) { litersInp.value = (t/p).toFixed(2); }
        else if (changed==='total' && !isNaN(t) && !isNaN(l) && l>0) { priceInp.value = (t/l).toFixed(2); }
      }
      on(priceInp,'input',function(){ calcFuel('price'); });
      on(litersInp,'input',function(){ calcFuel('liters'); });
      on(totalInp,'input',function(){ calcFuel('total'); });

      const cf = commonFields(); dynForm.appendChild(cf.row); formData.date=cf.date; formData.mili=cf.mili;

    } else if (cat==='insurance') {
      const permWrap = mk('div',{css:'display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:12px;background:#1E2230;border-radius:12px'});
      const permChk = mk('input'); permChk.type='checkbox';
      permChk.style.cssText='width:18px;height:18px;cursor:pointer;accent-color:#C8FF00';
      permWrap.appendChild(permChk);
      permWrap.appendChild(mk('span',{css:'font-size:14px',txt:'\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0439 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442'}));
      dynForm.appendChild(permWrap);
      const docName = mkInp('text',''); addField(dynForm,'\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430',docName); formData.docName=docName;
      const expiryField = mk('div',{cls:'field'});
      expiryField.appendChild(mk('label',{txt:'\u0414\u0430\u0442\u0430 \u043e\u043a\u043e\u043d\u0447\u0430\u043d\u0438\u044f'}));
      const expiryInp = mkInp('date',''); expiryField.appendChild(expiryInp); dynForm.appendChild(expiryField);
      formData.expiryInp=expiryInp; formData.permChk=permChk;
      permChk.addEventListener('change',function(){ expiryField.style.display=permChk.checked?'none':'block'; });
      const costInp = mkInp('number',''); addField(dynForm,'\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c (\u20BD)',costInp); formData.costInp=costInp;
      const cf = commonFields(); dynForm.appendChild(cf.row); formData.date=cf.date; formData.mili=cf.mili;

    } else if (cat==='tires') {
      const opWrap = mk('div',{cls:'field'});
      opWrap.appendChild(mk('label',{txt:'\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u044f'}));
      const opRow = mk('div',{css:'display:flex;gap:8px;margin-bottom:4px'});
      let selOp = 'change'; const opBtns = [];
      [['\u0417\u0430\u043c\u0435\u043d\u0430','change'],['\u0420\u0435\u043c\u043e\u043d\u0442','repair']].forEach(function(o){
        const b = mk('button',{cls:'pbtn '+(o[1]==='change'?'pbtnon':''), txt:o[0]});
        on(b,'click',function(){ opBtns.forEach(function(x){x.className='pbtn';}); b.className='pbtn pbtnon'; selOp=o[1]; formData.selOp=selOp; });
        opBtns.push(b); opRow.appendChild(b);
      });
      formData.selOp='change'; opWrap.appendChild(opRow); dynForm.appendChild(opWrap);

      const whatWrap = mk('div',{cls:'field'});
      whatWrap.appendChild(mk('label',{txt:'\u0427\u0442\u043e'}));
      const whatRow = mk('div',{css:'display:flex;gap:8px;margin-bottom:4px'});
      let selWhat = 'tire'; const whatBtns = [];
      [['\u0428\u0438\u043d\u0430','tire'],['\u0414\u0438\u0441\u043a','disk']].forEach(function(o){
        const b = mk('button',{cls:'pbtn '+(o[1]==='tire'?'pbtnon':''), txt:o[0]});
        on(b,'click',function(){ whatBtns.forEach(function(x){x.className='pbtn';}); b.className='pbtn pbtnon'; selWhat=o[1]; formData.selWhat=selWhat; });
        whatBtns.push(b); whatRow.appendChild(b);
      });
      formData.selWhat='tire'; whatWrap.appendChild(whatRow); dynForm.appendChild(whatWrap);

      const wheelWrap = mk('div',{cls:'field'});
      wheelWrap.appendChild(mk('label',{txt:'\u041a\u043e\u043b\u0435\u0441\u043e'}));
      const wheelGrid = mk('div',{css:'display:grid;grid-template-columns:1fr 1fr;gap:8px'});
      const wheels = [
        ['\u041f\u0435\u0440\u0435\u0434\u043d\u0435\u0435 \u043f\u0440\u0430\u0432\u043e\u0435','fr'],
        ['\u041f\u0435\u0440\u0435\u0434\u043d\u0435\u0435 \u043b\u0435\u0432\u043e\u0435','fl'],
        ['\u0417\u0430\u0434\u043d\u0435\u0435 \u043f\u0440\u0430\u0432\u043e\u0435','rr'],
        ['\u0417\u0430\u0434\u043d\u0435\u0435 \u043b\u0435\u0432\u043e\u0435','rl']
      ];
      const wheelChks = [];
      wheels.forEach(function(w){
        const wb = mk('div',{css:'display:flex;align-items:center;gap:8px;padding:10px;background:#1E2230;border-radius:10px;border:1px solid rgba(255,255,255,.07);cursor:pointer'});
        const wc = mk('input'); wc.type='checkbox'; wc.style.cssText='width:16px;height:16px;accent-color:#C8FF00';
        wb.appendChild(wc); wb.appendChild(mk('span',{css:'font-size:13px',txt:w[0]}));
        on(wb,'click',function(e){ if(e.target!==wc)wc.checked=!wc.checked; });
        wheelChks.push({chk:wc,key:w[1]}); wheelGrid.appendChild(wb);
      });
      formData.wheelChks=wheelChks; wheelWrap.appendChild(wheelGrid); dynForm.appendChild(wheelWrap);
      const costInp = mkInp('number',''); addField(dynForm,'\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0443\u0441\u043b\u0443\u0433\u0438 (\u20BD)',costInp); formData.costInp=costInp;
      const cf = commonFields(); dynForm.appendChild(cf.row); formData.date=cf.date; formData.mili=cf.mili;

    } else if (cat==='repair') {
      const title = mkInp('text',''); addField(dynForm,'\u0427\u0442\u043e \u0441\u0434\u0435\u043b\u0430\u043d\u043e *',title); formData.title=title;
      const part = mkInp('text',''); addField(dynForm,'\u0414\u0435\u0442\u0430\u043b\u044c / \u0437\u0430\u043f\u0447\u0430\u0441\u0442\u044c',part); formData.part=part;
      const costInp = mkInp('number',''); addField(dynForm,'\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c (\u20BD)',costInp); formData.costInp=costInp;
      const cf = commonFields(); dynForm.appendChild(cf.row); formData.date=cf.date; formData.mili=cf.mili;
      const notes = mkInp('textarea',''); addField(dynForm,T['notes-inp'],notes); formData.notes=notes;

    } else {
      const svc = mkInp('text',''); addField(dynForm,'\u0423\u0441\u043b\u0443\u0433\u0430',svc); formData.svc=svc;
      const part = mkInp('text',''); addField(dynForm,'\u0414\u0435\u0442\u0430\u043b\u044c',part); formData.part=part;
      const costInp = mkInp('number',''); addField(dynForm,'\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c (\u20BD)',costInp); formData.costInp=costInp;
      const cf = commonFields(); dynForm.appendChild(cf.row); formData.date=cf.date; formData.mili=cf.mili;
    }

    const btn = mk('button',{cls:'btnok',txt:T['save-record']});
    on(btn,'click',function(){ saveRecord(cat); });
    dynForm.appendChild(btn);
  }

  CATS.forEach(function(c) {
    const b = mk('div',{cls:'cat '+(c.id==='maintenance'?'caton':'')});
    b.appendChild(mk('div',{cls:'cdot',css:'background:'+c.color}));
    b.appendChild(document.createTextNode(c.ru));
    on(b,'click',function(){
      document.querySelectorAll('.cat').forEach(function(x){x.className='cat';});
      b.className='cat caton'; selCat=c.id; buildDyn(c.id);
    });
    cg.appendChild(b);
  });
  catDiv.appendChild(cg); modal.appendChild(catDiv);
  modal.appendChild(dynForm);
  buildDyn('maintenance');

  function saveRecord(cat) {
    const rec = {id:uid(), carId:selCarId, category:cat, createdAt:new Date().toISOString()};
    rec.date = (formData.date&&formData.date.value) ? formData.date.value : new Date().toISOString().slice(0,10);
    rec.mileage = formData.mili ? formData.mili.value : '';

    if (cat==='maintenance') {
      const parts=[]; let totalCost=0;
      (formData.chks||[]).forEach(function(r){
        if(r.chk.checked){ parts.push(r.key); totalCost+=parseFloat(r.cost.value)||0; }
      });
      if (parts.length===0) { showToast('\u0412\u044b\u0431\u0435\u0440\u0438 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u044d\u043b\u0435\u043c\u0435\u043d\u0442'); return; }
      rec.title = parts.join(', ');
      rec.cost = totalCost||'';
      rec.notes = formData.notes ? formData.notes.value : '';
      rec.maintenanceItems = parts;

    } else if (cat==='fuel') {
      const fuelLabel = formData.selFuelType==='benzin'?('\u0411\u0435\u043d\u0437\u0438\u043d '+(formData.octane||'95')):formData.selFuelType==='dizel'?'\u0414\u0438\u0437\u0435\u043b\u044c':'\u041c\u0435\u0442\u0430\u043d';
      const station = formData.stInp ? formData.stInp.value.trim() : '';
      if (station && formData.savedStations && formData.savedStations.indexOf(station)===-1) {
        formData.savedStations.push(station);
        D.stations = formData.savedStations;
      }
      rec.title = fuelLabel + (station?' \u2014 '+station:'');
      rec.fuelType = formData.selFuelType;
      rec.octane = formData.octane||'';
      rec.station = station;
      rec.pricePerLiter = formData.priceInp ? formData.priceInp.value : '';
      rec.liters = formData.litersInp ? formData.litersInp.value : '';
      rec.cost = formData.totalInp && formData.totalInp.value ? formData.totalInp.value : (rec.pricePerLiter&&rec.liters?(parseFloat(rec.pricePerLiter)*parseFloat(rec.liters)).toFixed(0):'');

    } else if (cat==='insurance') {
      if (!formData.docName.value.trim()) { showToast(T['need-name']); return; }
      rec.title = formData.docName.value.trim();
      rec.isPermanent = formData.permChk.checked;
      rec.expiry = formData.permChk.checked ? '' : formData.expiryInp.value;
      rec.cost = formData.costInp.value;
      if (!formData.permChk.checked && formData.expiryInp.value) {
        if (!D.reminders) D.reminders=[];
        D.reminders.push({id:uid(),carId:selCarId,title:rec.title,icon:'\ud83d\udcdc',intervalType:'date',lastDate:rec.date,intervalMonths:Math.max(1,Math.round((new Date(formData.expiryInp.value)-new Date(rec.date))/2592000000)-1),expiryDate:formData.expiryInp.value,createdAt:new Date().toISOString()});
      }

    } else if (cat==='tires') {
      const selWheels = (formData.wheelChks||[]).filter(function(w){return w.chk.checked;}).map(function(w){return w.key;});
      const whatLabel = formData.selWhat==='tire'?'\u0448\u0438\u043d\u0430':'\u0434\u0438\u0441\u043a';
      const opLabel = formData.selOp==='change'?'\u0417\u0430\u043c\u0435\u043d\u0430':'\u0420\u0435\u043c\u043e\u043d\u0442';
      const wheelMap = {fr:'\u041f\u041f',fl:'\u041f\u041b',rr:'\u0417\u041f',rl:'\u0417\u041b'};
      rec.title = opLabel+' '+whatLabel+(selWheels.length>0?' ('+selWheels.map(function(w){return wheelMap[w];}).join(', ')+')':'');
      rec.tireOp = formData.selOp;
      rec.tireWhat = formData.selWhat;
      rec.wheels = selWheels;
      rec.cost = formData.costInp.value;

    } else if (cat==='repair') {
      if (!formData.title||!formData.title.value.trim()) { showToast(T['need-name']); return; }
      rec.title = formData.title.value.trim();
      rec.part = formData.part ? formData.part.value.trim() : '';
      rec.cost = formData.costInp ? formData.costInp.value : '';
      rec.notes = formData.notes ? formData.notes.value : '';

    } else {
      if (!formData.svc||!formData.svc.value.trim()) { showToast(T['need-name']); return; }
      rec.title = formData.svc.value.trim();
      rec.part = formData.part ? formData.part.value.trim() : '';
      rec.cost = formData.costInp ? formData.costInp.value : '';
    }

    D.records.push(rec);
    if (rec.mileage) {
      for (let ci=0; ci<D.cars.length; ci++) {
        if (D.cars[ci].id===selCarId) {
          const newMil = parseInt(rec.mileage);
          const curMil = parseInt(D.cars[ci].mileage)||0;
          if (newMil > curMil) {
            D.cars[ci].mileage = rec.mileage;
            (D.reminders||[]).forEach(function(r){
              if (r.carId===selCarId) r.currentKm = rec.mileage;
            });
          }
          break;
        }
      }
    }
    save(D); closeModal(); showToast(T['added-rec']); render();
  }
}
// ========== НАПОМИНАНИЯ ==========
function buildRemItem(r) {
  const pct=remPct(r), color=pColor(pct), days=daysLeft(r);
  const badge = days!==null?(days<=0?T['overdue']:days+' '+T['rem-days']):(pct>0?Math.min(pct,100)+'%':'');
  const row = mk('div',{cls:'remi'});
  row.appendChild(mk('div',{cls:'remico', css:'background:'+color+'18', txt:r.icon||'\ud83d\udd14'}));
  const rb = mk('div',{cls:'remb'});
  rb.appendChild(mk('div',{cls:'remttl', txt:r.title}));
  const meta = (r.intervalKm?T['rem-every-km']+' '+parseInt(r.intervalKm).toLocaleString('ru')+' '+T['rem-km-unit']:'')+
             (r.intervalKm&&r.intervalMonths?' \u00b7 ':'')+
             (r.intervalMonths?T['rem-every']+' '+r.intervalMonths+' '+T['rem-months']:'');
  rb.appendChild(mk('div',{cls:'remmeta', txt:meta}));
  if (pct > 0) { const pb=mk('div',{cls:'pbar'}); pb.appendChild(mk('div',{cls:'pfill', css:'width:'+Math.min(pct,100)+'%;background:'+color})); rb.appendChild(pb); }
  row.appendChild(rb);
  if (badge) row.appendChild(mk('div',{cls:'rbadge', css:'background:'+color+'18;color:'+color, txt:badge}));
  const del = on(mk('button',{cls:'ibtn', css:'width:32px;height:32px;border-radius:8px;flex-shrink:0', txt:'\u2715'}), 'click', function(){
    D.reminders=(D.reminders||[]).filter(function(x){return x.id!==r.id;}); saveNow(D); showToast(T['deleted']); render();
  });
  row.appendChild(del); return row;
}

function buildRemForm(modal, step, tmpl) {
  modal.innerHTML='';
  if (step===1) {
    mHdr(modal,T['rem-title'],false,null);
    modal.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;margin-bottom:14px',txt:T['rem-what']}));
    const tg=mk('div',{cls:'tmpls'});
    REM_LABELS.forEach(function(lbl,idx){
      const b=mk('div',{cls:'tmpl'}); b.appendChild(mk('span',{css:'font-size:20px',txt:REM_ICONS[idx]})); b.appendChild(document.createTextNode(lbl));
      on(b,'click',function(){buildRemForm(modal,2,{icon:REM_ICONS[idx],label:lbl,km:REM_KM[idx],mo:REM_MO[idx]});});
      tg.appendChild(b);
    });
    modal.appendChild(tg); return;
  }
  const car=D.cars.filter(function(c){return c.id===selCarId;})[0];
  mHdr(modal,T['rem-setup'],true,function(){buildRemForm(modal,1,null);});
  const title=mkInp('text','',tmpl?tmpl.label:''); addField(modal,T['rem-name'],title);
  const iDiv=mk('div',{cls:'field'}); iDiv.appendChild(mk('label',{txt:T['rem-interval']}));
  const irow=mk('div',{css:'display:flex;gap:8px;margin-bottom:12px'});
  let selItype='both'; const ibtns=[];
  [['km',T['rem-bykm']],['date',T['rem-bydate']],['both',T['rem-both']]].forEach(function(it){
    const b=mk('button',{cls:'pbtn '+(it[0]==='both'?'pbtnon':''),txt:it[1]});
    on(b,'click',function(){ ibtns.forEach(function(x){x.className='pbtn';}); b.className='pbtn pbtnon'; selItype=it[0]; kmRow.style.display=(it[0]==='km'||it[0]==='both')?'block':'none'; moRow.style.display=(it[0]==='date'||it[0]==='both')?'block':'none'; });
    ibtns.push(b); irow.appendChild(b);
  });
  iDiv.appendChild(irow);
  const kmInp=mkInp('number',T['rem-kmhint'],tmpl&&tmpl.km?tmpl.km:''); kmInp.style.marginBottom='8px';
  const kmRow=mk('div'); kmRow.appendChild(kmInp);
  const moInp=mkInp('number',T['rem-mohint'],tmpl&&tmpl.mo?tmpl.mo:'');
  const moRow=mk('div'); moRow.appendChild(moInp);
  iDiv.appendChild(kmRow); iDiv.appendChild(moRow); modal.appendChild(iDiv);
  const row=mk('div',{cls:'row2'});
  const ldate=mkInp('date','',new Date().toISOString().slice(0,10)); const df=mk('div',{cls:'field'}); df.appendChild(mk('label',{txt:T['rem-last']})); df.appendChild(ldate); row.appendChild(df);
  const lkm=mkInp('number','',car?car.mileage:''); const mf=mk('div',{cls:'field'}); mf.appendChild(mk('label',{txt:T['rem-lastkm']})); mf.appendChild(lkm); row.appendChild(mf);
  modal.appendChild(row);
  const ckm=mkInp('number','',car?car.mileage:''); addField(modal,T['rem-cur'],ckm);
  on(addField(modal,'',mk('button',{cls:'btnok',txt:T['rem-save']})),'click',function(){
    if (!title.value.trim()) { showToast(T['need-name']); return; }
    if (!D.reminders) D.reminders=[];
    D.reminders.push({id:uid(),carId:selCarId,title:title.value.trim(),icon:tmpl?tmpl.icon:'\ud83d\udd14',intervalType:selItype,intervalKm:kmInp.value,intervalMonths:moInp.value,lastDate:ldate.value,lastKm:lkm.value,currentKm:ckm.value,createdAt:new Date().toISOString()});
    save(D); closeModal(); showToast(T['added-rem']); render();
  });
}

// ========== ПЛАНЫ РЕМОНТА ==========
function buildPlanItem(p, car) {
  const pr = {color:PRI_COLOR[p.priority]||'#F59E0B', label:PRI_LABEL[p.priority]||PRI_LABEL.medium};
  const q = genQ(car, p);
  const row = mk('div',{cls:'plan'});
  row.appendChild(mk('div',{cls:'planbar', css:'background:'+pr.color}));
  const pb = mk('div',{cls:'planb'});
  const ttl = mk('div',{cls:'planttl', txt:p.title});
  if (p.part) ttl.appendChild(mk('span',{css:'font-size:12px;color:#7A8099;font-weight:400;margin-left:6px', txt:'\u00b7 '+p.part}));
  pb.appendChild(ttl);
  const meta = mk('div',{cls:'planmeta'});
  meta.appendChild(mk('span',{css:'color:'+pr.color+';font-weight:600;font-size:11px', txt:pr.label}));
  if (p.estimatedCost) meta.appendChild(mk('span',{txt:'\u2248'+parseFloat(p.estimatedCost).toLocaleString('ru')+' \u20BD'}));
  if (p.deadline) meta.appendChild(mk('span',{txt:'\u043e\u0442 '+new Date(p.deadline).toLocaleDateString('ru',{day:'numeric',month:'short'})}));
  pb.appendChild(meta);
  if (p.notes) pb.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;line-height:1.5;margin-bottom:8px;padding:8px 10px;background:#1E2230;border-radius:10px', txt:p.notes}));
  const acts = mk('div',{cls:'planacts'});
  acts.appendChild(on(mk('button',{cls:'donebtn', txt:'\u2713 '+T['done']}), 'click', function(){
    D.records.push({id:uid(),carId:p.carId,title:p.title,category:p.category||'repair',part:p.part||'',date:new Date().toISOString().slice(0,10),mileage:'',cost:p.estimatedCost||'',notes:p.notes||'',createdAt:new Date().toISOString()});
    D.planned=(D.planned||[]).filter(function(x){return x.id!==p.id;}); saveNow(D); showToast(T['done-toast']); render();
  }));
  acts.appendChild(mk('a',{cls:'sbtn', txt:'\ud83d\udd0d Exist', href:'https://exist.ru/search/?q='+encodeURIComponent(q), target:'_blank'}));
  acts.appendChild(mk('a',{cls:'sbtn', txt:'Avito', href:'https://www.avito.ru/rossiya?q='+encodeURIComponent(q), target:'_blank'}));
  acts.appendChild(on(mk('button',{cls:'sbtn', css:'color:#EF4444;border-color:rgba(239,68,68,.2)', txt:'\ud83d\uddd1'}), 'click', function(){
    D.planned=(D.planned||[]).filter(function(x){return x.id!==p.id;}); saveNow(D); showToast(T['deleted']); render();
  }));
  pb.appendChild(acts); row.appendChild(pb); return row;
}

function buildPlanForm(modal) {
  mHdr(modal,'\ud83d\udccb '+T['plan-modal'],false,null);
  modal.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;margin-bottom:16px;line-height:1.4',txt:T['plan-hint']}));
  const title=mkInp('text',''); addField(modal,T['plan-what']+' *',title);
  const part=mkInp('text',''); addField(modal,T['plan-part'],part);
  const priDiv=mk('div',{cls:'field'}); priDiv.appendChild(mk('label',{txt:T['plan-priority']}));
  const ps=mk('div',{cls:'prisel'}); let selPri='medium'; const pbtns=[];
  [['high',T['plan-urgent'],'prih'],['medium',T['plan-soon'],'prim'],['low',T['plan-low'],'pril']].forEach(function(p){
    const b=mk('button',{cls:'pribtn '+(p[0]==='medium'?p[2]:''),txt:p[1]});
    on(b,'click',function(){ pbtns.forEach(function(x){x.className='pribtn';}); b.className='pribtn '+p[2]; selPri=p[0]; });
    pbtns.push(b); ps.appendChild(b);
  });
  priDiv.appendChild(ps); modal.appendChild(priDiv);
  const row=mk('div',{cls:'row2'});
  const cost=mkInp('number',''); const cf=mk('div',{cls:'field'}); cf.appendChild(mk('label',{txt:T['plan-cost']})); cf.appendChild(cost); row.appendChild(cf);
  const dead=mkInp('date',''); const df=mk('div',{cls:'field'}); df.appendChild(mk('label',{txt:T['plan-deadline']})); df.appendChild(dead); row.appendChild(df);
  modal.appendChild(row);
  const notes=mkInp('textarea',''); addField(modal,T['plan-notes'],notes);
  on(addField(modal,'',mk('button',{cls:'btnok',txt:T['plan-add']})),'click',function(){
    if (!title.value.trim()) { showToast(T['need-name']); return; }
    if (!D.planned) D.planned=[];
    D.planned.push({id:uid(),carId:selCarId,title:title.value.trim(),part:part.value.trim(),priority:selPri,estimatedCost:cost.value,deadline:dead.value,notes:notes.value.trim(),category:'repair',createdAt:new Date().toISOString()});
    save(D); closeModal(); showToast(T['added-plan']); render();
  });
}

// ========== ПОГОДА И РЕЗИНА ==========
function buildTireWidget(car, lt) {
  const wrap = mk('div');
  wrap.appendChild(mk('div',{cls:'sec', txt:'\ud83c\udf21\ufe0f '+T['tire-lbl']}));
  if (!lt) {
    const info = mk('div',{cls:'card', css:'font-size:13px;color:#7A8099;line-height:1.5;margin-bottom:4px', txt:T['tire-hint']});
    wrap.appendChild(info); return wrap;
  }
  const status = tireStatusRegional(lt, forecastData, car);
  const bg = status&&(status.level==='danger'||status.level==='critical')?'rgba(239,68,68,.06)':status&&status.level==='warn'?'rgba(245,158,11,.06)':'#161920';
  const bd = status&&(status.level==='danger'||status.level==='critical')?'rgba(239,68,68,.25)':status&&status.level==='warn'?'rgba(245,158,11,.2)':'rgba(255,255,255,.07)';
  const crd = mk('div',{cls:'wcrd', css:'background:'+bg+';border-color:'+bd});
  const trow = mk('div',{css:'display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:12px'});
  const tEmoji = lt.tireType==='winter'?'\u2744\ufe0f':lt.tireType==='all-season'?'\ud83d\udd04':'\ud83c\udf1e';
  trow.appendChild(mk('span',{css:'font-size:22px', txt:tEmoji}));
  const ti = mk('div',{css:'flex:1'});
  const tLabel = lt.tireType==='summer'?T['tire-summer']:lt.tireType==='winter'?T['tire-winter']:T['tire-all'];
  ti.appendChild(mk('div',{css:'font-size:13px;font-weight:600', txt:tLabel}));
  ti.appendChild(mk('div',{css:'font-size:12px;color:#7A8099', txt:T['installed']+' '+fmtDateShort(lt.date)+(lt.mileage?' \u00b7 '+parseInt(lt.mileage).toLocaleString('ru')+' \u043a\u043c':'')}));
  trow.appendChild(ti);
  if (!weatherData) {
    trow.appendChild(on(mk('button',{cls:'pbtn', css:'font-size:11px;white-space:nowrap', txt:'\ud83d\udccd '+T['weather-btn']}), 'click', fetchWeather));
  }
  crd.appendChild(trow);
  if (weatherData) {
    const wtop = mk('div',{css:'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px'});
    const wl = mk('div');
    const wrow = mk('div',{css:'display:flex;align-items:center;gap:8px'});
    wrow.appendChild(mk('span',{css:'font-size:36px', txt:wEmoji(weatherData.weather[0].main)}));
    const wt = mk('div');
    wt.appendChild(mk('div',{cls:'wtemp', txt:Math.round(weatherData.main.temp)+'\u00b0'}));
    wt.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;margin-top:3px', txt:weatherData.weather[0].description}));
    wrow.appendChild(wt); wl.appendChild(wrow);
    wl.appendChild(mk('div',{css:'font-size:12px;color:#7A8099;margin-top:6px', txt:'\ud83d\udccd '+weatherData.name+' \u00b7 '+T['weather-city']+' '+Math.round(weatherData.main.feels_like)+'\u00b0'}));
    wtop.appendChild(wl);
    wtop.appendChild(on(mk('button',{cls:'pbtn', css:'font-size:11px', txt:'\ud83d\udd04'}), 'click', fetchWeather));
    crd.appendChild(wtop);
    if (forecastData&&forecastData.list) {
      const frow = mk('div',{cls:'frow'});
      forecastData.list.filter(function(_,i){return i%8===0;}).slice(0,5).forEach(function(d,i){
        const day = mk('div',{cls:'fday'});
        const dt = new Date(d.dt*1000);
        day.appendChild(mk('div',{cls:'fdnm', txt:i===0?T['today']:DAYS[dt.getDay()]}));
        day.appendChild(mk('div',{css:'font-size:18px', txt:wEmoji(d.weather[0].main)}));
        day.appendChild(mk('div',{cls:'fdmx', txt:Math.round(d.main.temp_max)+'\u00b0'}));
        day.appendChild(mk('div',{cls:'fdmn', txt:Math.round(d.main.temp_min)+'\u00b0'}));
        frow.appendChild(day);
      });
      crd.appendChild(frow);
    }
  }
  if (status) {
    const cls = 'tadvice '+(status.level==='ok'?'tok':status.level==='warn'?'twarn':'tcrit');
    crd.appendChild(mk('div',{cls:cls, txt:status.msg}));
  }
  wrap.appendChild(crd); return wrap;
}

function fetchWeather() {
  if (!navigator.geolocation) { showToast(T['geo-unsupported']); return; }
  showToast(T['geo-detecting']);
  navigator.geolocation.getCurrentPosition(function(pos) {
    const K='bd5e378503939ddaee76f12ad7a97608';
    const lat=pos.coords.latitude, lon=pos.coords.longitude;
    Promise.all([
      fetch('https://api.openweathermap.org/data/2.5/weather?lat='+lat+'&lon='+lon+'&units=metric&lang=ru&appid='+K),
      fetch('https://api.openweathermap.org/data/2.5/forecast?lat='+lat+'&lon='+lon+'&units=metric&lang=ru&appid='+K)
    ]).then(function(rs){ return Promise.all(rs.map(function(r){return r.json();})); })
    .then(function(data){
      if (data[0].cod!==200) throw new Error('err');
      weatherData=data[0]; forecastData=data[1]; showToast(T['weather-loaded']); render();
    }).catch(function(){ showToast(T['weather-fail']); });
  }, function(){ showToast(T['weather-err']); });
}

// ========== PDF ЭКСПОРТ ==========
function exportPDF(car) {
  const recs = cRecs(car.id);
  const spent = cSpent(car.id);
  const now = new Date().toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'});

  let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/>';
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;color:#1a1a1a;max-width:800px;margin:0 auto;padding:32px;font-size:13px}';
  html += 'h1{font-size:24px;font-weight:800;margin-bottom:4px;color:#0D0F14}';
  html += '.sub{color:#7A8099;font-size:13px;margin-bottom:24px}';
  html += '.meta{display:flex;gap:24px;margin-bottom:24px;padding:16px;background:#f8f8f8;border-radius:8px}';
  html += '.meta-item{flex:1}';
  html += '.meta-label{font-size:10px;color:#7A8099;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}';
  html += '.meta-val{font-size:16px;font-weight:700}';
  html += 'table{width:100%;border-collapse:collapse;margin-bottom:24px}';
  html += 'th{background:#0D0F14;color:#fff;padding:10px 12px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.05em}';
  html += 'tr:nth-child(even){background:#f8f8f8}';
  html += 'td{padding:10px 12px;border-bottom:1px solid #eee;font-size:12px}';
  html += '.cat-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600}';
  html += '.total-row{background:#0D0F14!important;color:#fff}';
  html += '.total-row td{color:#fff;font-weight:700;font-size:14px}';
  html += '.footer{text-align:center;color:#7A8099;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #eee}';
  html += '@media print{body{padding:16px}}';
  html += '</style></head><body>';

  html += '<h1>CarDiary \u2014 '+car.make+' '+car.model+'</h1>';
  html += '<div class="sub">\u041e\u0442\u0447\u0451\u0442 \u0441\u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d '+now+'</div>';

  html += '<div class="meta">';
  html += '<div class="meta-item"><div class="meta-label">\u0410\u0432\u0442\u043e\u043c\u043e\u0431\u0438\u043b\u044c</div><div class="meta-val">'+car.make+' '+car.model+' '+car.year+'</div></div>';
  if(car.engine) html += '<div class="meta-item"><div class="meta-label">\u0414\u0432\u0438\u0433\u0430\u0442\u0435\u043b\u044c</div><div class="meta-val">'+car.engine+'</div></div>';
  if(car.vin) html += '<div class="meta-item"><div class="meta-label">VIN</div><div class="meta-val" style="font-family:monospace;font-size:13px">'+car.vin+'</div></div>';
  if(car.mileage) html += '<div class="meta-item"><div class="meta-label">\u041f\u0440\u043e\u0431\u0435\u0433</div><div class="meta-val">'+parseInt(car.mileage).toLocaleString('ru')+' \u043a\u043c</div></div>';
  html += '</div>';

  const catColors = {maintenance:'#3B82F6',repair:'#EF4444',tires:'#10B981',fuel:'#F59E0B',insurance:'#8B5CF6',other:'#6B7280'};

  html += '<table>';
  html += '<tr><th>\u0414\u0430\u0442\u0430</th><th>\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435</th><th>\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f</th><th>\u041f\u0440\u043e\u0431\u0435\u0433</th><th>\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c</th></tr>';

  recs.forEach(function(rec){
    const cat = catById(rec.category);
    const color = catColors[rec.category]||'#6B7280';
    let desc = rec.title;
    if (rec.part) desc += ' (' + rec.part + ')';
    if (rec.liters) desc += ' \u2014 '+rec.liters+' \u043b';
    if (rec.station) desc += ' @ '+rec.station;
    if (rec.expiry) desc += ' \u0434\u043e '+fmtDate(rec.expiry);
    if (rec.notes) desc += '<br><span style="color:#999;font-size:11px">'+rec.notes+'</span>';
    html += '<tr>';
    html += '<td>'+fmtDate(rec.date)+'</td>';
    html += '<td>'+desc+'</td>';
    html += '<td><span class="cat-badge" style="background:'+color+'22;color:'+color+'">'+cat.ru+'</span></td>';
    html += '<td>'+(rec.mileage?parseInt(rec.mileage).toLocaleString('ru')+' \u043a\u043c':'\u2014')+'</td>';
    html += '<td style="font-weight:600">'+(rec.cost?parseFloat(rec.cost).toLocaleString('ru')+' \u20BD':'\u2014')+'</td>';
    html += '</tr>';
  });

  html += '<tr class="total-row">';
  html += '<td colspan="4">\u0418\u0442\u043e\u0433\u043e \u043f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e</td>';
  html += '<td>'+spent.toLocaleString('ru')+' \u20BD</td>';
  html += '</tr>';
  html += '</table>';

  html += '<div class="footer">CarDiary \u2014 \u0414\u043d\u0435\u0432\u043d\u0438\u043a \u0430\u0432\u0442\u043e\u043c\u043e\u0431\u0438\u043b\u044f</div>';
  html += '</body></html>';

  const win = window.open('','_blank');
  if (!win) { showToast('\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0438\u0435 \u043e\u043a\u043d\u0430'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(function(){ win.print(); }, 500);
}
// ========== ФОТО ==========
function compressPhoto(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const MAX = 900;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h = Math.round(h*MAX/w); w = MAX; } }
        else { if (h > MAX) { w = Math.round(w*MAX/h); h = MAX; } }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openLightbox(photos, startIdx, rec) {
  const lb = mk('div',{cls:'photo-lightbox'});
  let curIdx = startIdx;

  const imgEl = mk('img',{src:photos[curIdx]});
  lb.appendChild(imgEl);

  const btns = mk('div',{cls:'photo-lb-btns'});

  if (photos.length > 1) {
    const prevBtn = on(mk('button',{cls:'photo-close-btn',txt:'\u2190'}),'click',function(){
      curIdx = (curIdx-1+photos.length)%photos.length;
      imgEl.src = photos[curIdx];
    });
    const nextBtn = on(mk('button',{cls:'photo-close-btn',txt:'\u2192'}),'click',function(){
      curIdx = (curIdx+1)%photos.length;
      imgEl.src = photos[curIdx];
    });
    btns.appendChild(prevBtn); btns.appendChild(nextBtn);
  }

  const delBtn = on(mk('button',{cls:'photo-del-btn',txt:'\ud83d\uddd1 \u0423\u0434\u0430\u043b\u0438\u0442\u044c'}),'click',function(){
    if (!confirm('\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0444\u043e\u0442\u043e?')) return;
    for(let i=0;i<D.records.length;i++){
      if(D.records[i].id===rec.id){
        D.records[i].photos=(D.records[i].photos||[]).filter(function(_,pi){return pi!==curIdx;});
        break;
      }
    }
    saveNow(D); lb.remove(); showToast('\u0424\u043e\u0442\u043e \u0443\u0434\u0430\u043b\u0435\u043d\u043e'); render();
  });
  const closeBtn = on(mk('button',{cls:'photo-close-btn',txt:'\u0417\u0430\u043a\u0440\u044b\u0442\u044c'}),'click',function(){ lb.remove(); });
  btns.appendChild(delBtn); btns.appendChild(closeBtn);
  lb.appendChild(btns);
  on(lb,'click',function(e){ if(e.target===lb) lb.remove(); });
  document.body.appendChild(lb);
}

// ========== РЕГИОНЫ И РЕЗИНА ==========
const REGIONS = [
  {id:'moscow',   label:'\u041c\u043e\u0441\u043a\u0432\u0430 / \u0426\u0435\u043d\u0442\u0440', winterFrom:[10,15], winterTo:[4,15], summerFrom:[4,15], summerTo:[10,15]},
  {id:'spb',      label:'\u041f\u0435\u0442\u0435\u0440\u0431\u0443\u0440\u0433',                winterFrom:[10,1],  winterTo:[4,20], summerFrom:[4,20], summerTo:[10,1]},
  {id:'south',    label:'\u042e\u0433 (\u041a\u0440\u0430\u0441\u043d\u043e\u0434\u0430\u0440)',  winterFrom:[11,15], winterTo:[3,15], summerFrom:[3,15], summerTo:[11,15]},
  {id:'ural',     label:'\u0423\u0440\u0430\u043b / \u0421\u0438\u0431\u0438\u0440\u044c',       winterFrom:[9,15],  winterTo:[5,15], summerFrom:[5,15], summerTo:[9,15]},
  {id:'siberia',  label:'\u0421\u0438\u0431\u0438\u0440\u044c (\u0433\u043b\u0443\u0431\u044c)',  winterFrom:[9,1],   winterTo:[5,20], summerFrom:[5,20], summerTo:[9,1]}
];

function getRegion(car) {
  const id = car.region || 'moscow';
  for (let i=0;i<REGIONS.length;i++) { if (REGIONS[i].id===id) return REGIONS[i]; }
  return REGIONS[0];
}

function tireStatusRegional(lt, forecast, car) {
  if (!lt||!lt.tireType) return null;
  const t = lt.tireType;
  if (t==='all-season') return {level:'ok', msg:T['tire-allseason-ok']};
  const reg = getRegion(car);
  const now=new Date(), m=now.getMonth()+1, d=now.getDate();

  const deepW = (m===12&&d>reg.winterFrom[1])||m===1||m===2||(m===reg.winterTo[0]&&d<reg.winterTo[1]);
  const deepS = m>=6&&m<=8;

  if (deepW&&t==='summer') return {level:'danger', msg:T['tire-danger-summer']};
  if (deepS&&t==='winter') return {level:'danger', msg:T['tire-danger-winter']};

  const inA = m===reg.winterFrom[0]||(m===reg.winterFrom[0]-1&&d>15);
  const inSp = m===reg.summerFrom[0]||(m===reg.summerFrom[0]-1&&d>15);

  if (forecast&&forecast.list) {
    const days=forecast.list.filter(function(_,i){return i%8===0;}).slice(0,7);
    const mins=days.map(function(x){return x.main.temp_min;});
    const maxs=days.map(function(x){return x.main.temp_max;});
    const snow=days.some(function(x){return x.weather[0].main==='Snow';});
    const frost=mins.some(function(x){return x<=0;});
    const coldN=mins.filter(function(x){return x<7;}).length;
    const warmD=maxs.filter(function(x){return x>10;}).length;
    const avgMin=mins.reduce(function(a,b){return a+b;},0)/mins.length;
    const avgMax=maxs.reduce(function(a,b){return a+b;},0)/maxs.length;
    if (inA&&t==='summer') {
      if (snow||frost) return {level:'critical', msg:T['tire-frost']};
      if (coldN>=4) return {level:'warn', msg:coldN+' '+T['tire-cold']};
      return {level:'ok', msg:T['tire-ok-summer']};
    }
    if (inSp&&t==='winter') {
      if (avgMax>15&&avgMin>7) return {level:'critical', msg:T['tire-hot']};
      if (warmD>=5&&avgMin>3) return {level:'warn', msg:warmD+' '+T['tire-warm']};
      return {level:'ok', msg:T['tire-ok-winter']};
    }
  }
  if (inA&&t==='summer') return {level:'warn', msg:T['tire-warn-autumn']};
  if (inSp&&t==='winter') return {level:'warn', msg:T['tire-warn-spring']};
  const tLabel = t==='summer'?T['tire-summer']:t==='winter'?T['tire-winter']:T['tire-all'];
  return {level:'ok', msg:tLabel+' - '+T['tire-season-ok']};
}

// ========== ШЕЙРИНГ ==========
function openShareModal(car) {
  closeModal();
  const ov = on(mk('div',{cls:'overlay'}),'click',function(e){if(e.target===ov)closeModal();});
  const modal = mk('div',{cls:'modal'});
  mHdr(modal,'\ud83d\udd17 \u041e\u0431\u0449\u0438\u0439 \u0434\u043e\u0441\u0442\u0443\u043f',false,null);

  modal.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;margin-bottom:20px;line-height:1.5',
    txt:'\u0414\u0440\u0443\u0433\u043e\u0439 \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u0432\u0432\u0435\u0434\u0451\u0442 \u044d\u0442\u043e\u0442 \u043a\u043e\u0434 \u0438 \u043f\u043e\u043b\u0443\u0447\u0438\u0442 \u043f\u043e\u043b\u043d\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u043c\u0430\u0448\u0438\u043d\u0435.'}));

  if (car.inviteCode) {
    const codeBox = mk('div',{css:'background:#1E2230;border:1px solid rgba(200,255,0,.2);border-radius:14px;padding:20px;text-align:center;margin-bottom:16px'});
    codeBox.appendChild(mk('div',{css:'font-size:11px;color:#7A8099;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em',txt:'\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043a\u043e\u0434'}));
    codeBox.appendChild(mk('div',{css:'font-family:Syne,sans-serif;font-size:32px;font-weight:800;color:#C8FF00;letter-spacing:4px',txt:car.inviteCode}));
    const copyCodeBtn = on(mk('button',{css:'margin-top:12px;padding:8px 16px;border-radius:10px;background:rgba(200,255,0,.1);border:1px solid rgba(200,255,0,.2);color:#C8FF00;font-size:13px;cursor:pointer',txt:'\ud83d\udccb \u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043a\u043e\u0434'}), 'click', function(){
      navigator.clipboard.writeText(car.inviteCode).then(function(){ showToast('\u041a\u043e\u0434 \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d'); });
    });
    codeBox.appendChild(copyCodeBtn);
    modal.appendChild(codeBox);
  }

  const codeField = mk('div',{cls:'field'});
  codeField.appendChild(mk('label',{txt:car.inviteCode ? '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043a\u043e\u0434' : '\u041f\u0440\u0438\u0434\u0443\u043c\u0430\u0439 \u043a\u043e\u0434 \u0434\u043e\u0441\u0442\u0443\u043f\u0430'}));
  const codeInp = mkInp('text','',car.inviteCode||'');
  codeInp.style.fontFamily='monospace'; codeInp.style.letterSpacing='3px'; codeInp.style.textTransform='uppercase'; codeInp.style.fontSize='20px'; codeInp.style.textAlign='center';
  codeField.appendChild(codeInp); modal.appendChild(codeField);

  const errBox = mk('div',{css:'color:#EF4444;font-size:13px;margin-bottom:8px;display:none'});
  modal.appendChild(errBox);

  const saveBtn = on(mk('button',{cls:'btnok',txt:'\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u043e\u0434'}), 'click', function(){
    const code = codeInp.value.trim().toUpperCase();
    if (!code) { errBox.textContent='\u0412\u0432\u0435\u0434\u0438 \u043a\u043e\u0434'; errBox.style.display='block'; return; }
    if (code.length < 3) { errBox.textContent='\u041c\u0438\u043d\u0438\u043c\u0443\u043c 3 \u0441\u0438\u043c\u0432\u043e\u043b\u0430'; errBox.style.display='block'; return; }
    saveBtn.textContent='\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u043c...'; saveBtn.disabled=true;
    setInviteCode(car.id, code, function(result){
      if (result==='ok') { closeModal(); showToast('\u041a\u043e\u0434 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u2713'); render(); }
      else if (result==='taken') { errBox.textContent='\u042d\u0442\u043e\u0442 \u043a\u043e\u0434 \u0443\u0436\u0435 \u0437\u0430\u043d\u044f\u0442'; errBox.style.display='block'; saveBtn.textContent='\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u043e\u0434'; saveBtn.disabled=false; }
      else { errBox.textContent='\u041e\u0448\u0438\u0431\u043a\u0430, \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u043f\u043e\u0437\u0436\u0435'; errBox.style.display='block'; saveBtn.textContent='\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u043e\u0434'; saveBtn.disabled=false; }
    });
  });
  modal.appendChild(saveBtn);
  ov.appendChild(modal); document.body.appendChild(ov); currentModal=ov;
}

function openJoinModal() {
  closeModal();
  const ov = on(mk('div',{cls:'overlay'}),'click',function(e){if(e.target===ov)closeModal();});
  const modal = mk('div',{cls:'modal'});
  mHdr(modal,'\ud83d\udd17 \u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f \u043f\u043e \u043a\u043e\u0434\u0443',false,null);

  modal.appendChild(mk('div',{css:'font-size:13px;color:#7A8099;margin-bottom:20px;line-height:1.5',
    txt:'\u0412\u0432\u0435\u0434\u0438 \u043a\u043e\u0434 \u043a\u043e\u0442\u043e\u0440\u044b\u0439 \u0434\u0430\u043b \u0432\u043b\u0430\u0434\u0435\u043b\u0435\u0446 \u043c\u0430\u0448\u0438\u043d\u044b.'}));

  const codeInp = mkInp('text','','');
  codeInp.style.fontFamily='monospace'; codeInp.style.letterSpacing='3px'; codeInp.style.textTransform='uppercase'; codeInp.style.fontSize='22px'; codeInp.style.textAlign='center';
  addField(modal,'\u041a\u043e\u0434 \u0434\u043e\u0441\u0442\u0443\u043f\u0430',codeInp);

  const errBox = mk('div',{css:'color:#EF4444;font-size:13px;margin-bottom:8px;display:none'});
  modal.appendChild(errBox);

  const joinBtn = on(mk('button',{cls:'btnok',txt:'\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f'}), 'click', function(){
    const code = codeInp.value.trim();
    if (!code) { errBox.textContent='\u0412\u0432\u0435\u0434\u0438 \u043a\u043e\u0434'; errBox.style.display='block'; return; }
    joinBtn.textContent='\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0430\u0435\u043c\u0441\u044f...'; joinBtn.disabled=true;
    joinByCode(code, function(result){
      if (result==='ok') {
        closeModal();
        loadFromCloud(function(newData){ D=newData; render(); showToast('\u041c\u0430\u0448\u0438\u043d\u0430 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0430 \u2713'); });
      } else if (result==='not_found') {
        errBox.textContent='\u041a\u043e\u0434 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d'; errBox.style.display='block'; joinBtn.textContent='\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f'; joinBtn.disabled=false;
      } else if (result==='already_member') {
        errBox.textContent='\u0423 \u0442\u0435\u0431\u044f \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u044d\u0442\u043e\u0439 \u043c\u0430\u0448\u0438\u043d\u0435'; errBox.style.display='block'; joinBtn.textContent='\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f'; joinBtn.disabled=false;
      } else {
        errBox.textContent='\u041e\u0448\u0438\u0431\u043a\u0430, \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u043f\u043e\u0437\u0436\u0435'; errBox.style.display='block'; joinBtn.textContent='\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f'; joinBtn.disabled=false;
      }
    });
  });
  modal.appendChild(joinBtn);
  ov.appendChild(modal); document.body.appendChild(ov); currentModal=ov;
}

// ========== АВТОРИЗАЦИЯ ==========
function renderAuth(tab) {
  var preload = document.getElementById('preload');
  if (preload) preload.style.display = 'none';
  const app = document.getElementById('app');
  app.innerHTML = '';
  const wrap = mk('div',{cls:'auth-wrap'});
  const card = mk('div',{cls:'auth-card'});

  const logo = mk('div',{cls:'auth-logo'});
  logo.appendChild(document.createTextNode('Car'));
  logo.appendChild(mk('span',{txt:'Diary'}));
  card.appendChild(logo);
  card.appendChild(mk('div',{cls:'auth-sub', txt:'\u0414\u043d\u0435\u0432\u043d\u0438\u043a \u0432\u0430\u0448\u0435\u0433\u043e \u0430\u0432\u0442\u043e\u043c\u043e\u0431\u0438\u043b\u044f'}));

  const tabs = mk('div',{cls:'auth-tabs'});
  const tabLogin = mk('button',{cls:'auth-tab '+(tab==='login'?'on':''), txt:'\u0412\u043e\u0439\u0442\u0438'});
  const tabReg   = mk('button',{cls:'auth-tab '+(tab==='register'?'on':''), txt:'\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f'});
  tabs.appendChild(tabLogin); tabs.appendChild(tabReg);
  card.appendChild(tabs);

  const errBox = mk('div',{cls:'auth-err'});
  card.appendChild(errBox);

  function showErr(msg) { errBox.textContent=msg; errBox.style.display='block'; }
  function hideErr() { errBox.style.display='none'; }

  const emailInp = mk('input',{cls:'inp', type:'email'});
  emailInp.placeholder='email@example.com';
  const passInp = mk('input',{cls:'inp', type:'password'});
  passInp.placeholder='\u041f\u0430\u0440\u043e\u043b\u044c';
  const pass2Inp = mk('input',{cls:'inp', type:'password'});
  pass2Inp.placeholder='\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c';

  const efWrap = mk('div',{cls:'field'}); efWrap.appendChild(mk('label',{txt:'Email'})); efWrap.appendChild(emailInp); card.appendChild(efWrap);
  const pfWrap = mk('div',{cls:'field'}); pfWrap.appendChild(mk('label',{txt:'\u041f\u0430\u0440\u043e\u043b\u044c'})); pfWrap.appendChild(passInp); card.appendChild(pfWrap);

  const p2fWrap = mk('div',{cls:'field',css:tab==='register'?'':'display:none'});
  p2fWrap.appendChild(mk('label',{txt:'\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c'}));
  p2fWrap.appendChild(pass2Inp);
  card.appendChild(p2fWrap);

  const forgotWrap = mk('div',{cls:'auth-forgot', css:tab==='login'?'':'display:none'});
  const forgotBtn = mk('button',{txt:'\u0417\u0430\u0431\u044b\u043b \u043f\u0430\u0440\u043e\u043b\u044c?'});
  on(forgotBtn,'click',function(){
    const email = emailInp.value.trim();
    if (!email) { showErr('\u0412\u0432\u0435\u0434\u0438 email \u0434\u043b\u044f \u0441\u0431\u0440\u043e\u0441\u0430 \u043f\u0430\u0440\u043e\u043b\u044f'); return; }
    auth.sendPasswordResetEmail(email).then(function(){
      showToast('\u041f\u0438\u0441\u044c\u043c\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043d\u0430 '+email);
      hideErr();
    }).catch(function(e){ showErr(authErrMsg(e.code)); });
  });
  forgotWrap.appendChild(forgotBtn);
  card.appendChild(forgotWrap);

  const actionBtn = mk('button',{cls:'btnok', txt:tab==='login'?'\u0412\u043e\u0439\u0442\u0438':'\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442'});
  on(actionBtn,'click',function(){
    hideErr();
    const email = emailInp.value.trim();
    const pass = passInp.value;
    if (!email || !pass) { showErr('\u0417\u0430\u043f\u043e\u043b\u043d\u0438 \u0432\u0441\u0435 \u043f\u043e\u043b\u044f'); return; }
    if (tab==='register') {
      if (pass !== pass2Inp.value) { showErr('\u041f\u0430\u0440\u043e\u043b\u0438 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442'); return; }
      if (pass.length < 6) { showErr('\u041f\u0430\u0440\u043e\u043b\u044c \u043c\u0438\u043d\u0438\u043c\u0443\u043c 6 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432'); return; }
      actionBtn.textContent='\u0421\u043e\u0437\u0434\u0430\u0451\u043c...'; actionBtn.disabled=true;
      auth.createUserWithEmailAndPassword(email, pass)
        .catch(function(e){ actionBtn.textContent='\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442'; actionBtn.disabled=false; showErr(authErrMsg(e.code)); });
    } else {
      actionBtn.textContent='\u0412\u0445\u043e\u0434\u0438\u043c...'; actionBtn.disabled=true;
      auth.signInWithEmailAndPassword(email, pass)
        .catch(function(e){ actionBtn.textContent='\u0412\u043e\u0439\u0442\u0438'; actionBtn.disabled=false; showErr(authErrMsg(e.code)); });
    }
  });
  card.appendChild(actionBtn);

  on(tabLogin,'click',function(){ renderAuth('login'); });
  on(tabReg,'click',function(){ renderAuth('register'); });

  on(passInp,'keydown',function(e){ if(e.key==='Enter') actionBtn.click(); });
  on(pass2Inp,'keydown',function(e){ if(e.key==='Enter') actionBtn.click(); });

  wrap.appendChild(card);
  app.appendChild(wrap);
}

function authErrMsg(code) {
  const msgs = {
    'auth/user-not-found': '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d',
    'auth/wrong-password': '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c',
    'auth/invalid-email': '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0444\u043e\u0440\u043c\u0430\u0442 email',
    'auth/email-already-in-use': '\u042d\u0442\u043e\u0442 email \u0443\u0436\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d',
    'auth/weak-password': '\u041f\u0430\u0440\u043e\u043b\u044c \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043f\u0440\u043e\u0441\u0442\u043e\u0439',
    'auth/too-many-requests': '\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u043d\u043e\u0433\u043e \u043f\u043e\u043f\u044b\u0442\u043e\u043a. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u043f\u043e\u0437\u0436\u0435',
    'auth/invalid-credential': '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 email \u0438\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044c'
  };
  return msgs[code] || '\u041e\u0448\u0438\u0431\u043a\u0430: '+code;
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
function showError(msg) {
  const app = document.getElementById('app');
  if (app) app.innerHTML = '<div style="padding:24px;color:#EF4444;font-family:monospace;font-size:13px;word-break:break-all;background:#0D0F14;min-height:100vh"><b>Error:</b><br>' + msg + '</div>';
}

// Показываем индикатор загрузки сразу
(function() {
  var s = document.getElementById('preload-status');
  if (s) s.textContent = 'app.js загружен ✓';
})();

// Страховка: если Firebase завис и onAuthStateChanged не сработал
var authFired = false;
setTimeout(function() {
  if (!authFired) {
    renderAuth('login');
  }
}, 5000);

auth.onAuthStateChanged(function(user) {
  authFired = true;
  try {
    if (user) {
      currentUser = user;
      loadFromCloud(function(cloudData) {
        try {
          if (cloudData.cars.length === 0) {
            migrateOldData(function(migrated) {
              try {
                if (migrated) {
                  loadFromCloud(function(newData){ D = newData; view='home'; render(); });
                } else {
                  D = cloudData; view='home'; render();
                }
              } catch(e3) { showError('migrate render: '+e3.message); }
            });
          } else {
            D = cloudData; view='home'; render();
          }
        } catch(e2) { showError('loadFromCloud cb: '+e2.message); }
      });
    } else {
      currentUser = null;
      D = load();
      renderAuth('login');
    }
  } catch(e) { showError('auth: '+e.message); }
});

// ========== SERVICE WORKER ==========
// Service Worker отключён
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(reg) { reg.unregister(); });
  });
}
