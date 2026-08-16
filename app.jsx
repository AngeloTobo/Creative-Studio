/* app.jsx — root: routing, responsive, tweaks, state */
const { useState: uS, useEffect: uE } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": ["#a855f7", "#ec4899"],
  "lift": 16,
  "font": "Space Grotesk",
  "orbSpeed": 1,
  "glassOp": 6,
  "glassBlur": 18
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  'Space Grotesk': ["'Space Grotesk', sans-serif", "'Inter', sans-serif"],
  'Syne': ["'Syne', sans-serif", "'Inter', sans-serif"],
  'Sora': ["'Sora', sans-serif", "'Inter', sans-serif"],
};
const ACCENTS = [
  ['#a855f7', '#ec4899'], // violet → pink (default)
  ['#8b5cf6', '#22d3ee'], // purple → cyan
  ['#fb7185', '#fbbf24'], // rose → amber
  ['#34d399', '#22d3ee'], // emerald → cyan
];

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function hex(c) { return [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)]; }
function mix(c1, c2, t) { const a = hex(c1), b = hex(c2); return `rgb(${lerp(a[0],b[0],t)},${lerp(a[1],b[1],t)},${lerp(a[2],b[2],t)})`; }

function applyTweaks(t) {
  const r = document.documentElement.style;
  r.setProperty('--accent', t.accent[0]);
  r.setProperty('--accent-2', t.accent[1]);
  r.setProperty('--violet', t.accent[0]);
  r.setProperty('--pink', t.accent[1]);
  const lift = (t.lift ?? 16) / 100;
  r.setProperty('--bg-0', mix('#08091a', '#1a1f3d', lift));
  r.setProperty('--bg-main', mix('#0d1020', '#232a52', lift));
  r.setProperty('--bg-soft', mix('#141731', '#2b3160', lift));
  r.setProperty('--bg-elev', mix('#1a1e3c', '#343b6e', lift));
  const [disp, body] = FONT_PAIRS[t.font] || FONT_PAIRS['Space Grotesk'];
  r.setProperty('--font-display', disp);
  r.setProperty('--font-body', body);
  r.setProperty('--orb-speed', t.orbSpeed ?? 1);
  r.setProperty('--glass-op', (t.glassOp ?? 6) / 100);
  r.setProperty('--glass-strong-op', ((t.glassOp ?? 6) + 5) / 100);
  r.setProperty('--glass-blur', (t.glassBlur ?? 18) + 'px');
}

function VATweaks({ t, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Accent" />
      <TweakColor label="Orb + accent" value={t.accent} options={ACCENTS} onChange={v => setTweak('accent', v)} />
      <TweakSection label="Atmosphere" />
      <TweakSlider label="Light ↔ dark" value={t.lift} min={0} max={100} unit="" onChange={v => setTweak('lift', v)} />
      <TweakSlider label="Orb speed" value={t.orbSpeed} min={0.3} max={2} step={0.1} unit="×" onChange={v => setTweak('orbSpeed', v)} />
      <TweakSection label="Glass" />
      <TweakSlider label="Panel opacity" value={t.glassOp} min={2} max={16} unit="%" onChange={v => setTweak('glassOp', v)} />
      <TweakSlider label="Blur" value={t.glassBlur} min={0} max={32} unit="px" onChange={v => setTweak('glassBlur', v)} />
      <TweakSection label="Type" />
      <TweakRadio label="Display font" value={t.font} options={['Space Grotesk', 'Syne', 'Sora']} onChange={v => setTweak('font', v)} />
    </TweaksPanel>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  uE(() => { applyTweaks(t); }, [t]);

  const [view, setView] = uS('portal');
  const [project] = uS(PROJECTS[0]);
  const [toast, setToast] = uS(null);
  const [genSeed, setGenSeed] = uS({ type: 'video', prompt: '', project: PROJECTS[1].name, k: 0 });
  const [chatSeed, setChatSeed] = uS(0);
  const [w, setW] = uS(window.innerWidth);
  const track = MEDIA[2];
  const forceMobile = new URLSearchParams(location.search).get('m') === '1';

  uE(() => { const f = () => setW(window.innerWidth); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const isMobile = forceMobile || w < 860;
  const wide = w >= 1240;

  const flash = (msg) => { const id = Date.now(); setToast({ id, msg }); setTimeout(() => setToast(c => (c && c.id === id ? null : c)), 2400); };
  const go = (v) => setView(v);
  const onNode = (id) => { if (['chat', 'generate', 'library', 'gallery', 'projects', 'flows'].includes(id)) go(id); else if (id === 'create') go('generate'); };
  const onCreate = (type) => { setGenSeed(s => ({ ...s, type, k: s.k + 1 })); go('generate'); };
  const onAsk = (text) => { if (text && text.trim()) { setChatSeed(c => c + 1); go('chat'); } else go('chat'); };
  const sendToGenerate = (prompt) => { setGenSeed(s => ({ ...s, prompt: (prompt || '').replace(/^PROMPT\s+/, '').split('\n')[0].slice(0, 140), k: s.k + 1 })); go('generate'); flash('Prompt sent to Generate'); };
  const saveLibrary = () => flash('Saved to Library');
  const sendToChat = () => { setChatSeed(c => c + 1); go('chat'); flash('Sent to Chat'); };
  const onQueue = () => flash('Added to creative queue');
  const onOpenMedia = () => flash('Opening asset…');

  const renderView = () => {
    switch (view) {
      case 'portal': return <PortalView setView={go} onNode={onNode} onCreate={onCreate} onAsk={onAsk} onOpenMedia={onOpenMedia} />;
      case 'generate': return <GenerateView key={genSeed.k} initialType={genSeed.type} initialPrompt={genSeed.prompt} initialProject={genSeed.project} onQueue={onQueue} />;
      case 'chat': return <ChatView key={chatSeed} onSaveLibrary={saveLibrary} onSendGenerate={sendToGenerate} />;
      case 'library': return <LibraryView onSendGenerate={sendToGenerate} onSendChat={sendToChat} toast={flash} />;
      case 'gallery': return <GalleryView onOpenMedia={onOpenMedia} />;
      case 'queue': return <QueueView />;
      default: return <Placeholder view={view} onBack={() => go('portal')} />;
    }
  };

  const TITLES = {
    portal: ['Welcome back, Angelo.', <>This is your <span className="hl">portal</span>. What shall we create today?</>],
    generate: ['Generate', 'What are we creating today?'],
    chat: ['Chat', 'Brainstorm, plan, and create.'],
    library: ['Library', 'Prompts, styles, and creative memory.'],
    gallery: ['Gallery', 'Explore your creations.'],
    queue: ['Creative Queue', 'Your active creative jobs.'],
    projects: ['Projects', 'Your creative worlds.'],
    flows: ['Flows', 'Repeatable creative processes.'],
    analytics: ['Analytics', 'Your creative activity.'],
    settings: ['Settings', 'Make it yours.'],
    integrations: ['Integrations', 'Connect your tools.'],
  };
  const [title, subtitle] = TITLES[view] || ['', ''];

  if (isMobile) {
    const inner = (
      <>
        <div className="cosmos" />
        <MobileShell view={view} setView={go} project={project} onNode={onNode} onCreate={onCreate} onOpenMedia={onOpenMedia}>
          {renderView()}
        </MobileShell>
        <Toast toast={toast} />
      </>
    );
    if (forceMobile) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#07091a' }}>
          <div style={{ width: 390, height: 844, position: 'relative', overflow: 'hidden', borderRadius: 44, border: '10px solid #16161e', boxShadow: '0 40px 90px -20px #000', transform: 'translateZ(0)' }}>
            {inner}
          </div>
          <VATweaks t={t} setTweak={setTweak} />
        </div>
      );
    }
    return <>{inner}<VATweaks t={t} setTweak={setTweak} /></>;
  }

  return (
    <>
      <div className="cosmos" />
      <div className={'app' + (wide ? '' : ' no-right')}>
        <Sidebar view={view} setView={go} project={project} theme={t.lift <= 6 ? 'dark' : t.lift >= 40 ? 'light' : 'mid'}
          setTheme={(th) => setTweak('lift', th === 'dark' ? 4 : th === 'light' ? 52 : 16)} />
        <main className="main">
          <TopBar title={title} subtitle={subtitle} />
          <div className="view-scroll scroll">{renderView()}</div>
        </main>
        {wide && <RightPanel project={project} setView={go} onOpenActivity={() => go('gallery')} />}
        <MediaPlayer track={track} />
      </div>
      <Toast toast={toast} />
      <VATweaks t={t} setTweak={setTweak} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
