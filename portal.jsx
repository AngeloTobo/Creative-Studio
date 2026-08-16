/* portal.jsx — desktop Portal view */
function OrbNode({ node, onClick }) {
  // ellipse placement
  const rad = node.angle * Math.PI / 180;
  const cx = 50 + Math.cos(rad) * 40;   // % of stage width
  const cy = 47 + Math.sin(rad) * 40;   // % of stage height
  const left = Math.cos(rad) < -0.08;
  const Icon = I[node.icon || node.id] || I.generate;
  return (
    <div className={'onode' + (left ? ' left' : '')}
      style={{ left: cx + '%', top: cy + '%', '--na': node.accent, animationDelay: -(node.angle / 60) + 's' }}
      onClick={() => onClick(node.id)}>
      <div className="onode-ic"><Icon size={24} /></div>
      <div className="onode-tx">
        <div className="ont-1">{node.label}</div>
        <div className="ont-2">{node.sub}</div>
      </div>
    </div>
  );
}

function CreateCard({ t, onClick }) {
  const Icon = I[t.id === 'music' ? 'music' : t.id === 'image' ? 'image' : t.id === 'voice' ? 'voice' : t.id === 'other' ? 'cube' : 'video'];
  return (
    <button className="ccard" style={{ '--ca': t.accent }} onClick={() => onClick(t.id)}>
      <div className="ccard-top">
        <div className="ccard-ic"><Icon size={20} /></div>
        <div className="ccard-name">{t.label}</div>
        <div className="ccard-desc">{t.desc}</div>
      </div>
      <div className="ccard-art">
        <div className="cca-g" />
        <div className="cca-wave">
          {Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ height: (18 + Math.abs(Math.sin(i * 0.9 + t.label.length)) * 80) + '%' }} />)}
        </div>
      </div>
    </button>
  );
}

function PortalView({ setView, onNode, onCreate, onAsk, onOpenMedia }) {
  const [ask, setAsk] = useState('');
  const nodes = ORB_NODES.map(n => ({ ...n, icon: n.id }));
  return (
    <div className="portal fade-up">
      <div className="orb-stage">
        <div className="orb-center"><Orb size={400} /></div>
        {nodes.map(n => <OrbNode key={n.id} node={n} onClick={onNode} />)}
      </div>

      <div className="portal-input glass-strong">
        <input value={ask} onChange={e => setAsk(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onAsk(ask); }}
          placeholder="Ask anything… create everything." />
        <button className="pi-go" onClick={() => onAsk(ask)}><I.arrow size={20} /></button>
      </div>

      <div className="portal-bottom">
        <div className="panel glass">
          <SectionHead label="Create Something New" />
          <div className="create-cards">
            {CREATE_TYPES.map(t => <CreateCard key={t.id} t={t} onClick={onCreate} />)}
          </div>
        </div>
        <div className="panel glass">
          <SectionHead label="Recent Creations" action="View all" onAction={() => setView('gallery')} />
          <div className="recent-grid">
            {MEDIA.slice(0, 4).map(m => (
              <button className="rcard" key={m.id} onClick={() => onOpenMedia(m)}>
                <Thumb g={m.g} type={m.type} dur={m.dur} />
                <div className="rc-meta">
                  <div style={{ minWidth: 0 }}>
                    <div className="rc-title">{m.title}</div>
                    <div className="rc-sub">{m.meta}</div>
                  </div>
                  <div className="rc-ago">{m.ago}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
window.PortalView = PortalView;
