/* shell.jsx — sidebar, topbar, right panel, media player */

const NAV_MAIN = [
  { id: 'portal', label: 'Portal', icon: 'portal' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'generate', label: 'Generate', icon: 'generate', chev: true },
  { id: 'library', label: 'Library', icon: 'library', chev: true },
  { id: 'gallery', label: 'Gallery', icon: 'gallery' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'flows', label: 'Flows', icon: 'flows', badge: 'New' },
  { id: 'queue', label: 'Queue', icon: 'queue' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
];
const NAV_SYS = [
  { id: 'integrations', label: 'Integrations', icon: 'integrations' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function NavItem({ item, active, onClick }) {
  const Icon = I[item.icon];
  return (
    <button className={'nav-item' + (active ? ' active' : '')} onClick={onClick}
      title={item.label}>
      <span className="ni-ic"><Icon size={21} /></span>
      <span>{item.label}</span>
      {item.badge && <span className="ni-badge">{item.badge}</span>}
      {item.chev && !item.badge && <span className="ni-ic" style={{ marginLeft: 'auto', opacity: .5 }}><I.chevronDown size={16} /></span>}
    </button>
  );
}

function Sidebar({ view, setView, project, theme, setTheme }) {
  return (
    <aside className="sidebar scroll">
      <div className="brand">
        <div className="brand-mark"><span className="bm-ring" /><span className="bm-orb" /></div>
        <div className="brand-txt">
          <div className="bt-1">ANGELO</div>
          <div className="bt-2">VA</div>
          <div className="bt-3">creative command system</div>
        </div>
      </div>

      <div className="nav-cap eyebrow">Main</div>
      <nav className="nav">
        {NAV_MAIN.map(it => <NavItem key={it.id} item={it} active={view === it.id} onClick={() => setView(it.id)} />)}
      </nav>

      <div className="nav-cap eyebrow">System</div>
      <nav className="nav">
        {NAV_SYS.map(it => <NavItem key={it.id} item={it} active={view === it.id} onClick={() => setView(it.id)} />)}
      </nav>

      <div className="sb-spacer" />

      <div className="sb-proj">
        <button className="sb-proj-btn" onClick={() => setView('projects')}>
          <ProjAvatar p={project} size={40} />
          <div className="sp-meta" style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <div className="sp-name">{project.name}</div>
            <div className="sp-sub">Active project</div>
          </div>
          <span className="sp-chev" style={{ color: 'var(--text-faint)' }}><I.chevronDown size={16} /></span>
        </button>
      </div>

      <div className="sb-user glass" style={{ borderRadius: 14 }}>
        <div className="su-av">A</div>
        <div className="su-meta" style={{ flex: 1, minWidth: 0 }}>
          <div className="su-name">AngeloCreates</div>
          <div className="su-role">Creative Director</div>
        </div>
        <span className="su-meta" style={{ color: 'var(--text-faint)' }}><I.settings size={17} /></span>
      </div>

      <div className="theme-toggle">
        <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')} title="Light"><I.sun size={17} /></button>
        <button className={theme === 'mid' ? 'on' : ''} onClick={() => setTheme('mid')} title="Balanced"><I.portal size={17} /></button>
        <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')} title="Dark"><I.moon size={17} /></button>
      </div>
    </aside>
  );
}

function TopBar({ title, subtitle }) {
  return (
    <header className="topbar">
      <div className="greet">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="topbar-spacer" />
      <div className="searchbar">
        <I.search size={18} />
        <input placeholder="Search anything…" />
        <span className="kbd">⌘K</span>
      </div>
      <button className="btn-icon bell"><I.bell size={20} /><span className="bdot" /></button>
    </header>
  );
}

function RightPanel({ project, setView, onOpenActivity }) {
  return (
    <aside className="rightpanel scroll">
      <div className="rp-card glass">
        <SectionHead label="Active Project" action="View all" onAction={() => setView('projects')} />
        <div className="rp-proj">
          <ProjAvatar p={project} size={54} />
          <div className="rpp-body">
            <div className="rpp-name">{project.name} <span className={'badge ' + (project.status === 'Active' ? 'active' : 'draft')}>{project.status}</span></div>
            <div className="rpp-desc">{project.description} {project.note}</div>
          </div>
        </div>
      </div>

      <div className="rp-card glass">
        <SectionHead label="Project Memory" action="View all" onAction={() => setView('library')} />
        <div className="mem-list">
          {[['copy', '128', 'Prompts'], ['gallery', '342', 'Outputs'], ['wand', '12', 'Style Rules']].map(([ic, v, l]) => {
            const Icon = I[ic];
            return <div className="mem-row" key={l}><span className="mr-ic"><Icon size={16} /></span><span><b className="mr-val">{v}</b> {l}</span></div>;
          })}
          <div className="mem-row"><span className="mr-ic"><I.flows size={16} /></span>
            <div style={{ flex: 1 }}>LoRA training in progress<div className="mem-bar"><i style={{ width: '64%' }} /></div></div>
          </div>
        </div>
      </div>

      <div className="rp-card glass">
        <SectionHead label="Queue Overview" action="View all" onAction={() => setView('queue')} />
        <div className="queue-mini">
          <div className="qm-stat"><div className="qm-num" style={{ color: 'var(--green)' }}>3</div><div className="qm-lab">Running</div></div>
          <div className="qm-stat"><div className="qm-num" style={{ color: 'var(--amber)' }}>2</div><div className="qm-lab">Queued</div></div>
          <div className="qm-stat"><div className="qm-num" style={{ color: 'var(--text-faint)' }}>0</div><div className="qm-lab">Failed</div></div>
        </div>
        <div className="qm-bars">
          {Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ height: (30 + Math.abs(Math.sin(i * 1.7)) * 70) + '%', animationDelay: -(i * 0.13) + 's' }} />)}
        </div>
      </div>

      <div className="rp-card glass">
        <SectionHead label="Recent Activity" action="View all" onAction={() => setView('gallery')} />
        <div>
          {ACTIVITY.map(a => (
            <div className="act-row" key={a.id} onClick={onOpenActivity}>
              <Thumb className="ar-thumb" g={a.g} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ar-title">{a.title}</div>
                <div className="ar-sub">{a.sub}</div>
              </div>
              <Dot state={a.state} />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function MediaPlayer({ track }) {
  const [playing, setPlaying] = useState(true);
  const [pct, setPct] = useState(43);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPct(p => (p >= 100 ? 0 : p + 0.25)), 600);
    return () => clearInterval(t);
  }, [playing]);
  const fmt = (p) => { const s = Math.floor(p / 100 * 165); return `0${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
  return (
    <div className="player">
      <div className="pl-now">
        <Thumb className="pln-thumb" g={track.g} />
        <div style={{ minWidth: 0 }}>
          <div className="pln-title">{track.title}</div>
          <div className="pln-sub">{track.meta} · {track.dur}</div>
        </div>
      </div>
      <div className="pl-ctrls">
        <button className="pl-btn"><I.shuffle size={18} /></button>
        <button className="pl-btn"><I.prev size={20} /></button>
        <button className="pl-btn pl-play" onClick={() => setPlaying(p => !p)}>{playing ? <I.pause size={20} /> : <I.play size={20} />}</button>
        <button className="pl-btn"><I.next size={20} /></button>
        <button className="pl-btn"><I.repeat size={18} /></button>
      </div>
      <div className="pl-prog">
        <span className="pl-time">{fmt(pct)}</span>
        <div className="pl-track" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPct((e.clientX - r.left) / r.width * 100); }}>
          <i style={{ width: pct + '%' }} />
        </div>
        <span className="pl-time">{track.dur}</span>
      </div>
      <div className="pl-end">
        <div className="pl-vol"><I.volume size={18} /><div className="pv-track"><i /></div></div>
        <button className="pl-btn"><I.heart size={18} /></button>
        <button className="pl-btn"><I.dots size={18} /></button>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, TopBar, RightPanel, MediaPlayer, NAV_MAIN });
