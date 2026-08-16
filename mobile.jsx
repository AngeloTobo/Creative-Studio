/* mobile.jsx — mobile shell + portal */
const MTABS = [
  { id: 'portal', label: 'Portal', icon: 'portal' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'generate', label: 'Generate', icon: 'generate' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'more', label: 'More', icon: 'more' },
];
const MORE_ITEMS = [
  { id: 'gallery', label: 'Gallery', icon: 'gallery' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'flows', label: 'Flows', icon: 'flows' },
  { id: 'queue', label: 'Queue', icon: 'queue' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const MOBILE_TYPES = [
  { id: 'video', label: 'Video', accent: 'var(--violet)' },
  { id: 'image', label: 'Image', accent: 'var(--cyan)' },
  { id: 'music', label: 'Music', accent: 'var(--pink)' },
  { id: 'voice', label: 'Voice', accent: 'var(--amber)' },
  { id: 'other', label: 'Other', accent: 'var(--teal)' },
];

function MobilePortal({ project, onNode, onCreate, onOpenMedia, setView }) {
  const mnodes = [
    { id: 'chat', accent: 'var(--violet)', angle: 200 },
    { id: 'create', accent: 'var(--pink)', angle: 340 },
    { id: 'generate', accent: 'var(--purple)', angle: 250 },
    { id: 'flows', accent: 'var(--rose)', angle: 290 },
    { id: 'library', accent: 'var(--blue)', angle: 160 },
    { id: 'gallery', accent: 'var(--amber)', angle: 110 },
    { id: 'projects', accent: 'var(--teal)', angle: 70 },
  ];
  return (
    <>
      <div className="mhead">
        <h1>Portal</h1>
        <p>What shall we create today?</p>
      </div>
      <div className="morb-stage">
        <div className="morb-center"><Orb size={188} /></div>
        {mnodes.map(n => {
          const rad = n.angle * Math.PI / 180;
          const Icon = I[n.id] || I.generate;
          return (
            <button key={n.id} className="mnode" style={{ left: 50 + Math.cos(rad) * 44 + '%', top: 50 + Math.sin(rad) * 44 + '%', '--na': n.accent }} onClick={() => onNode(n.id)}>
              <Icon size={20} />
            </button>
          );
        })}
      </div>

      <div className="msec-head"><span className="eyebrow">Create Something New</span></div>
      <div className="mchips">
        {MOBILE_TYPES.map(t => {
          const Icon = I[t.id === 'music' ? 'music' : t.id === 'image' ? 'image' : t.id === 'voice' ? 'voice' : t.id === 'other' ? 'cube' : 'video'];
          return (
            <button key={t.id} className="mctype" onClick={() => onCreate(t.id)}>
              <div className="mctype-ic" style={{ '--ca': t.accent }}><Icon size={28} /></div>
              <div className="mctype-lab">{t.label}</div>
            </button>
          );
        })}
      </div>

      <div className="msec-head"><span className="eyebrow">Recent Creations</span><button className="link-btn" onClick={() => setView('gallery')}>View all</button></div>
      <div className="mcarousel">
        {MEDIA.map(m => (
          <button className="mrcard" key={m.id} onClick={() => onOpenMedia(m)}>
            <Thumb g={m.g} type={m.type} dur={m.dur} />
            <div className="rc-title">{m.title}</div>
            <div className="rc-sub">{m.meta} · {m.ago}</div>
          </button>
        ))}
      </div>

      <div className="msec-head"><span className="eyebrow">Active Project</span></div>
      <button className="mproj-card glass" style={{ width: '100%' }} onClick={() => setView('projects')}>
        <ProjAvatar p={project} size={50} />
        <div className="mp-body" style={{ textAlign: 'left' }}>
          <div className="mp-name">{project.name} <span className={'badge ' + (project.status === 'Active' ? 'active' : 'draft')}>{project.status}</span></div>
          <div className="mp-desc">{project.description}</div>
        </div>
        <I.chevron size={18} style={{ color: 'var(--text-faint)' }} />
      </button>

      <div className="msec-head"><span className="eyebrow">Creative Queue</span><button className="link-btn" onClick={() => setView('queue')}>View all</button></div>
      <div className="mact-card glass">
        {ACTIVITY.slice(0, 3).map(a => (
          <div className="mact-row" key={a.id}>
            <Thumb className="ar-thumb" g={a.g} />
            <div style={{ flex: 1, minWidth: 0 }}><div className="ar-title">{a.title}</div><div className="ar-sub">{a.sub}</div></div>
            <Dot state={a.state} />
          </div>
        ))}
      </div>
    </>
  );
}

function MobileShell({ view, setView, project, children, onNode, onCreate, onOpenMedia, ...rest }) {
  const [more, setMore] = useState(false);
  const titles = { generate: ['Generate', 'What are we making?'], chat: ['Chat', 'Brainstorm, plan, and create'], library: ['Library', 'Prompts, styles, and memory'] };
  const isPortal = view === 'portal';
  return (
    <div className="mshell">
      <div className="mtop">
        <div className="mt-mark"><span className="bm-orb" /></div>
        <div className="mt-name">Angelo VA</div>
        <div className="mt-sp" />
        <button className="btn-icon bell" style={{ width: 40, height: 40 }}><I.bell size={19} /><span className="bdot" /></button>
      </div>

      <div className="mbody scroll">
        {isPortal
          ? <MobilePortal project={project} onNode={onNode} onCreate={onCreate} onOpenMedia={onOpenMedia} setView={setView} />
          : <>
              {titles[view] && <div className="mview-head"><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div>}
              {children}
            </>}
      </div>

      <nav className="mtabbar">
        {MTABS.map(t => {
          const Icon = I[t.icon];
          const active = t.id === 'more' ? more : (view === t.id && !more);
          return (
            <button key={t.id} className={'mtab' + (active ? ' on' : '')} onClick={() => { if (t.id === 'more') setMore(true); else { setMore(false); setView(t.id); } }}>
              <span className="mtab-ic"><Icon size={22} /></span>{t.label}
            </button>
          );
        })}
      </nav>

      {more && <>
        <div className="msheet-back" onClick={() => setMore(false)} />
        <div className="msheet">
          <div className="ms-grip" />
          <div className="msheet-grid">
            {MORE_ITEMS.map(it => {
              const Icon = I[it.icon];
              return <button key={it.id} className="msheet-item" onClick={() => { setView(it.id); setMore(false); }}><span className="msi-ic"><Icon size={24} /></span>{it.label}</button>;
            })}
          </div>
        </div>
      </>}
    </div>
  );
}
window.MobileShell = MobileShell;
