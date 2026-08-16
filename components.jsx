/* components.jsx — shared building blocks */
const { useState, useEffect, useRef, useMemo } = React;
const I = window.Icons;

/* gradient media thumbnail (swappable placeholder) */
function Thumb({ g, type, dur, className = '', style, children }) {
  return (
    <div className={'thumb ' + className} style={{
      background: `linear-gradient(135deg, ${g[0]}, ${g[1]})`, ...style }}>
      <div className="thumb-tex" />
      {type && <span className="thumb-type">{typeIcon(type)}</span>}
      {dur && <span className="thumb-dur">{dur}</span>}
      {children}
    </div>
  );
}
function typeIcon(type) {
  const map = { Video: 'video', Image: 'image', Music: 'music', Sound: 'music', Voice: 'voice' };
  const Cmp = I[map[type] || 'image'];
  return <Cmp size={15} />;
}

/* small status dot */
function Dot({ state }) {
  const c = { running: 'var(--green)', done: 'var(--cyan)', waiting: 'var(--amber)', failed: 'var(--rose)' }[state] || 'var(--green)';
  return <span className="dot" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />;
}

/* project avatar tile */
function ProjAvatar({ p, size = 44 }) {
  return (
    <div className="proj-av" style={{
      width: size, height: size, fontSize: size * 0.34,
      background: `linear-gradient(140deg, color-mix(in oklab, ${p.hue} 75%, #1a1136), color-mix(in oklab, ${p.hue} 30%, #140c2c))`,
      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${p.hue} 50%, transparent), 0 0 18px -6px ${p.hue}` }}>
      {p.initials}
    </div>
  );
}

/* section header with optional action */
function SectionHead({ label, action, onAction }) {
  return (
    <div className="sec-head">
      <span className="eyebrow">{label}</span>
      {action && <button className="link-btn" onClick={onAction}>{action}</button>}
    </div>
  );
}

/* toast */
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="toast glass-strong fade-up" key={toast.id}>
      <span className="toast-ic"><I.check size={16} /></span>
      <span>{toast.msg}</span>
    </div>
  );
}

Object.assign(window, { Thumb, typeIcon, Dot, ProjAvatar, SectionHead, Toast });
