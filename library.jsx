/* library.jsx — Library view */
function LibraryView({ onSendGenerate, onSendChat, toast }) {
  const [section, setSection] = useState('All');
  const [favs, setFavs] = useState(() => {
    const s = {}; Object.entries(LIBRARY).forEach(([sec, items]) => items.forEach((it, i) => { s[sec + i] = it.fav; })); return s;
  });

  const items = section === 'All'
    ? Object.entries(LIBRARY).flatMap(([sec, arr]) => arr.map((it, i) => ({ ...it, sec, key: sec + i })))
    : (LIBRARY[section] || []).map((it, i) => ({ ...it, sec: section, key: section + i }));

  return (
    <div className="lib fade-up">
      <div className="lib-tabs">
        {LIBRARY_SECTIONS.map(s => (
          <button key={s} className={'type-tab' + (section === s ? ' on' : '')} style={{ '--ta': 'var(--blue)', height: 40, fontSize: 13.5 }} onClick={() => setSection(s)}>{s}</button>
        ))}
      </div>
      <div className="lib-grid">
        {items.map(it => (
          <div className="lib-card glass" key={it.key}>
            <div className="lc-head">
              <span className="lc-tag">{it.tag}</span>
              <button className={'lc-fav' + (favs[it.key] ? ' on' : '')} onClick={() => setFavs(f => ({ ...f, [it.key]: !f[it.key] }))}>
                <I.star size={18} fill={favs[it.key] ? 'currentColor' : 'none'} />
              </button>
            </div>
            <div className="lc-title">{it.title}</div>
            <div className="lc-body">{it.body}</div>
            <div className="lc-foot">
              <span className="lc-proj">{it.project}</span>
              <div className="lc-acts">
                <button className="lc-act" title="Copy" onClick={() => toast('Copied to clipboard')}><I.copy size={16} /></button>
                <button className="lc-act" title="Send to Chat" onClick={() => onSendChat(it.body)}><I.chat size={16} /></button>
                <button className="lc-act" title="Send to Generate" onClick={() => onSendGenerate(it.body)}><I.generate size={16} /></button>
                <button className="lc-act" title="Edit"><I.edit size={16} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
window.LibraryView = LibraryView;
