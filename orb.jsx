/* orb.jsx — the living portal orb component */
function Orb({ size = 440, logo = true }) {
  const particles = React.useMemo(() => {
    const arr = [];
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 45;
      arr.push({
        left: 50 + Math.cos(ang) * 18 + '%',
        top: 50 + Math.sin(ang) * 18 + '%',
        px: Math.cos(ang) * r + 'px',
        py: Math.sin(ang) * r + 'px',
        pd: 7 + Math.random() * 7,
        pdelay: -Math.random() * 8 + 's',
      });
    }
    return arr;
  }, []);

  return (
    <div className="orb-wrap" style={{ '--orb-size': size + 'px' }}>
      <div className="orb-halo" />
      <div className="orb-orbits">
        <div className="ring" /><div className="ring r2" /><div className="ring r3" />
      </div>
      <div className="orb-ring a" />
      <div className="orb-ring b" />
      <div className="orb-sphere">
        <div className="orb-plasma" />
        <div className="orb-plasma p2" />
      </div>
      <div className="orb-core" />
      <div className="orb-glass" />
      {particles.map((p, i) => (
        <span key={i} className="orb-particle" style={{
          left: p.left, top: p.top,
          '--px': p.px, '--py': p.py, '--pd': p.pd, '--pdelay': p.pdelay,
        }} />
      ))}
      {logo && <div className="orb-logo">VA</div>}
    </div>
  );
}
window.Orb = Orb;
