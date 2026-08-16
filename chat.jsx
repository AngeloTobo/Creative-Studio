/* chat.jsx — Chat view */
const SEED_MESSAGES = [
  { who: 'me', text: 'Give me a director’s brief for the Internet Dreams teaser — 24 seconds, dreamy and nostalgic.' },
  { who: 'ai', head: 'Director’s Brief — Internet Dreams Teaser', text: 'Here’s a tight 24-second cut built around the orb as a recurring motif. Cuts land on the beat; no dialogue — let the synth carry it.',
    card: 'LOGLINE  A lonely signal wakes inside the machine and dreams its way home.\n\nBEAT 1 (0–6s)  Orb ignition. Black → violet bloom.\nBEAT 2 (6–16s)  Three nostalgic worlds, hard cuts on snares.\nBEAT 3 (16–24s)  Pull back to the orb. Logo bloom. Cut to black.',
    actions: ['save', 'generate', 'storyboard'] },
];

function ChatView({ onSaveLibrary, onSendGenerate }) {
  const [messages, setMessages] = useState(SEED_MESSAGES);
  const [draft, setDraft] = useState('');
  const threadRef = useRef(null);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [messages]);

  const send = (text) => {
    const t = (text || '').trim(); if (!t) return;
    setMessages(m => [...m, { who: 'me', text: t }]);
    setDraft('');
    setTimeout(() => {
      setMessages(m => [...m, {
        who: 'ai', head: 'On it',
        text: 'Drafted a structured response you can refine, save to your Library, or push straight into Generate.',
        card: 'PROMPT  ' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '\n\nSTYLE  Internet Dreams palette — magenta + violet bloom, CRT texture at 6%.\nMOTION  Slow push-in, anamorphic flares.',
        actions: ['save', 'generate'],
      }]);
    }, 600);
  };

  return (
    <div className="chat fade-up">
      <div className="chat-thread scroll" ref={threadRef}>
        {messages.map((m, i) => (
          <div className={'msg ' + (m.who === 'ai' ? 'ai' : 'me')} key={i}>
            <div className={'msg-av ' + (m.who === 'ai' ? 'ai' : 'me')}>{m.who === 'ai' ? <I.portal size={20} /> : 'A'}</div>
            <div className="msg-body">
              {m.head && <div className="mb-head">{m.head}</div>}
              <div>{m.text}</div>
              {m.card && <div className="mb-card">{m.card}</div>}
              {m.actions && (
                <div className="msg-actions">
                  {m.actions.includes('save') && <button className="msg-act" onClick={() => onSaveLibrary(m.head || 'Saved response')}><I.library size={15} /> Save to Library</button>}
                  {m.actions.includes('generate') && <button className="msg-act primary" onClick={() => onSendGenerate(m.card || m.text)}><I.generate size={15} /> Send to Generate</button>}
                  {m.actions.includes('storyboard') && <button className="msg-act"><I.grid size={15} /> Build storyboard</button>}
                  <button className="msg-act"><I.copy size={15} /> Copy</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="chat-foot">
        <div className="chat-chips scroll">
          {CHAT_CHIPS.map(c => <button key={c} className="chip" onClick={() => send(c)}><I.wand size={14} /> {c}</button>)}
        </div>
        <div className="chat-composer glass-strong">
          <textarea rows={1} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            placeholder="Ask anything… create everything." />
          <div className="cc-tools">
            <button className="btn-icon" style={{ width: 40, height: 40 }}><I.attach size={18} /></button>
            <button className="pi-go" style={{ width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(120deg, var(--accent), var(--accent-2))', color: '#fff' }} onClick={() => send(draft)}><I.send size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
window.ChatView = ChatView;
