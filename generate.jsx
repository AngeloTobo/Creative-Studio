/* generate.jsx — Generate view (Video + Music focus, all types) */
function MediaTypeTabs({ active, onChange }) {
  return (
    <div className="type-tabs">
      {CREATE_TYPES.flatMap(t => t.id === 'music' ? [t, { id: 'sound', label: 'Sound', accent: 'var(--rose)' }] : [t]).map(t => {
        const Icon = I[t.id === 'music' ? 'music' : t.id === 'sound' ? 'voice' : t.id === 'image' ? 'image' : t.id === 'voice' ? 'voice' : t.id === 'other' ? 'cube' : 'video'];
        return (
          <button key={t.id} className={'type-tab' + (active === t.id ? ' on' : '')} style={{ '--ta': t.accent }} onClick={() => onChange(t.id)}>
            <span className="tt-ic"><Icon size={18} /></span>{t.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function VideoForm({ accent, prompt, setPrompt, project, setProject }) {
  const [ratio, setRatio] = useState('16:9');
  const [dur, setDur] = useState('8s');
  return (
    <>
      <Field label="Prompt">
        <textarea className="textarea" value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Describe your shot— camera, mood, motion, lighting…" />
      </Field>
      <Field label="Reference image / video">
        <div className="upload-box"><I.upload size={20} /><div><div style={{ fontWeight: 600, color: 'var(--text-soft)' }}>Drop a reference</div><div style={{ fontSize: 11.5 }}>or click to browse · PNG, JPG, MP4</div></div></div>
      </Field>
      <div className="field-row">
        <Field label="Aspect ratio">
          <div className="ratio-row">
            {[['16:9', 26, 15], ['9:16', 15, 26], ['1:1', 22, 22], ['4:3', 26, 19]].map(([r, w, h]) => (
              <button key={r} className={'ratio' + (ratio === r ? ' on' : '')} onClick={() => setRatio(r)}>
                <span className="rt-box" style={{ width: w, height: h }} />{r}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Duration">
          <div className="seg">{['4s', '8s', '12s'].map(d => <button key={d} className={dur === d ? 'on' : ''} style={{ '--ta': accent }} onClick={() => setDur(d)}>{d}</button>)}</div>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Style preset"><select className="select"><option>Cinematic</option><option>Anime</option><option>Documentary</option><option>Dreamcore</option><option>Y2K nostalgia</option></select></Field>
        <Field label="Project"><select className="select" value={project} onChange={e => setProject(e.target.value)}>{PROJECTS.map(p => <option key={p.id}>{p.name}</option>)}</select></Field>
      </div>
    </>
  );
}

function MusicForm({ accent, prompt, setPrompt, project, setProject }) {
  const [type, setType] = useState('Song');
  return (
    <>
      <Field label="Audio type">
        <div className="seg">{['Song', 'Instrumental', 'SFX', 'Ambience', 'Loop'].map(t => <button key={t} className={type === t ? 'on' : ''} style={{ '--ta': accent }} onClick={() => setType(t)}>{t}</button>)}</div>
      </Field>
      <div className="field-row">
        <Field label="Mood"><select className="select"><option>Dreamy</option><option>Euphoric</option><option>Melancholic</option><option>Hype</option><option>Nostalgic</option></select></Field>
        <Field label="Genre / style"><select className="select"><option>Bedroom pop</option><option>Synthwave</option><option>Hyperpop</option><option>Lo-fi</option><option>Ambient</option></select></Field>
      </div>
      <Field label="Prompt">
        <textarea className="textarea" value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Describe the track— instruments, tempo, energy, reference vibe…" />
      </Field>
      <div className="field-row">
        <Field label="Duration"><select className="select"><option>0:30</option><option>1:00</option><option>2:00</option><option>Full track</option></select></Field>
        <Field label="Project"><select className="select" value={project} onChange={e => setProject(e.target.value)}>{PROJECTS.map(p => <option key={p.id}>{p.name}</option>)}</select></Field>
      </div>
    </>
  );
}

function GenericForm({ accent, prompt, setPrompt, project, setProject, label }) {
  return (
    <>
      <Field label="Prompt">
        <textarea className="textarea" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={`Describe your ${label.toLowerCase()}…`} />
      </Field>
      <div className="field-row">
        <Field label="Style preset"><select className="select"><option>Default</option><option>Editorial</option><option>Experimental</option></select></Field>
        <Field label="Project"><select className="select" value={project} onChange={e => setProject(e.target.value)}>{PROJECTS.map(p => <option key={p.id}>{p.name}</option>)}</select></Field>
      </div>
    </>
  );
}

function GenerateView({ initialType, initialPrompt, initialProject, onQueue }) {
  const [type, setType] = useState(initialType || 'video');
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [project, setProject] = useState(initialProject || PROJECTS[1].name);
  const [adv, setAdv] = useState(false);
  const [queued, setQueued] = useState(null);
  useEffect(() => { if (initialType) setType(initialType); }, [initialType]);
  useEffect(() => { if (initialPrompt) setPrompt(initialPrompt); }, [initialPrompt]);

  const allTypes = CREATE_TYPES.flatMap(t => t.id === 'music' ? [t, { id: 'sound', label: 'Sound', accent: 'var(--rose)', desc: 'Sound effects, ambience, and design.' }] : [t]);
  const t = allTypes.find(x => x.id === type) || allTypes[0];
  const accent = t.accent;
  const Icon = I[type === 'music' ? 'music' : type === 'sound' ? 'voice' : type === 'image' ? 'image' : type === 'voice' ? 'voice' : type === 'other' ? 'cube' : 'video'];
  const cta = { video: 'Generate Video', image: 'Generate Image', music: 'Generate Audio', sound: 'Generate Audio', voice: 'Generate Voice', other: 'Generate' }[type];

  const submit = () => {
    const job = { id: 'q' + Date.now(), title: (prompt.slice(0, 32) || t.label + ' creation'), type: t.label, project, state: 'running', pct: 4, eta: '~3 min', g: type === 'video' ? ['#3a1d6e', '#c026d3'] : type === 'music' || type === 'sound' ? ['#9d174d', '#7c3aed'] : ['#0e7490', '#a21caf'] };
    setQueued(job); onQueue(job);
  };
  useEffect(() => {
    if (!queued || queued.pct >= 100) return;
    const i = setInterval(() => setQueued(q => q ? { ...q, pct: Math.min(100, q.pct + 6) } : q), 700);
    return () => clearInterval(i);
  }, [queued]);

  return (
    <div className="gen fade-up">
      <MediaTypeTabs active={type} onChange={(v) => { setType(v); setQueued(null); }} />
      <div className="gen-grid">
        <div className="form-card glass">
          <div className="fc-head">
            <div className="fc-ic" style={{ '--ta': accent }}><Icon size={24} /></div>
            <div><div className="fc-title">{t.label}</div><div className="fc-sub">{t.desc}</div></div>
          </div>
          {type === 'video' && <VideoForm accent={accent} prompt={prompt} setPrompt={setPrompt} project={project} setProject={setProject} />}
          {(type === 'music' || type === 'sound') && <MusicForm accent={accent} prompt={prompt} setPrompt={setPrompt} project={project} setProject={setProject} />}
          {type === 'image' && <VideoForm accent={accent} prompt={prompt} setPrompt={setPrompt} project={project} setProject={setProject} />}
          {(type === 'voice' || type === 'other') && <GenericForm accent={accent} prompt={prompt} setPrompt={setPrompt} project={project} setProject={setProject} label={t.label} />}

          <div className="field">
            <button className="adv-toggle" onClick={() => setAdv(a => !a)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><I.sliders size={16} /> Advanced settings</span>
              <I.chevronDown size={16} style={{ transform: adv ? 'rotate(180deg)' : '', transition: 'transform .2s' }} />
            </button>
            {adv && <div className="field-row" style={{ marginTop: 12 }}>
              <Field label="Seed"><input className="input" placeholder="Random" /></Field>
              <Field label="Guidance"><input className="input" defaultValue="7.5" /></Field>
            </div>}
          </div>

          <div className="gen-cta">
            <button className="btn btn-primary" style={{ background: `linear-gradient(120deg, ${accent}, var(--accent-2))` }} onClick={submit}>
              <I.generate size={18} /> {cta}
            </button>
            <button className="btn btn-ghost"><I.copy size={17} /> Save prompt</button>
          </div>
        </div>

        <div className="gen-side">
          {queued ? (
            <div className="preview-card glass-strong fade-up">
              <SectionHead label={queued.pct >= 100 ? 'Ready' : 'Added to Queue'} />
              <div className="queued-item glass" style={{ marginBottom: 0 }}>
                <Thumb className="qi-thumb" g={queued.g} type={queued.type} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="qi-title">{queued.title}</div>
                  <div className="qi-sub">{queued.type} · {queued.project} · {queued.pct >= 100 ? 'Complete' : queued.eta}</div>
                  <div className="queued-prog"><i style={{ width: queued.pct + '%' }} /></div>
                </div>
              </div>
              <div className="gen-cta" style={{ marginTop: 16 }}>
                {queued.pct >= 100
                  ? <button className="btn btn-primary" style={{ flex: 1 }}><I.gallery size={17} /> Open result</button>
                  : <button className="btn btn-ghost" style={{ flex: 1 }}><I.queue size={17} /> View in Queue</button>}
              </div>
            </div>
          ) : (
            <div className="preview-card glass">
              <SectionHead label="Preview" />
              <div className="preview-art" style={{ background: `linear-gradient(140deg, color-mix(in oklab, ${accent} 40%, #16102e), #0d0a20)` }}>
                <div className="pa-orb" style={{ '--ta': accent }} />
                <span className="pa-label">Your {t.label.toLowerCase()} appears here</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.5 }}>
                Tune the form, then generate. Jobs run in the background and land in your Gallery when ready.
              </p>
            </div>
          )}
          <div className="preview-card glass">
            <SectionHead label="Recent in this type" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {MEDIA.filter(m => m.type === t.label || (t.label.includes(m.type))).slice(0, 3).concat(MEDIA.slice(0, 3)).slice(0, 3).map(m => (
                <div className="act-row" key={m.id}>
                  <Thumb className="ar-thumb" g={m.g} />
                  <div style={{ flex: 1, minWidth: 0 }}><div className="ar-title">{m.title}</div><div className="ar-sub">{m.meta} · {m.ago}</div></div>
                  <button className="lc-act"><I.rerun size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.GenerateView = GenerateView;
