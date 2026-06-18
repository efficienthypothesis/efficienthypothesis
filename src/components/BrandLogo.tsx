export function BrandLogo() {
  const circles = [
    ["#EF4444", 14, 18],
    ["#22C55E", 25, 15],
    ["#3B82F6", 36, 18],
    ["#F59E0B", 20, 29],
    ["#06B6D4", 31, 29],
    ["#A855F7", 14, 40],
    ["#EC4899", 36, 40]
  ] as const;

  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 50 56" aria-hidden="true">
        {circles.map(([fill, cx, cy], index) => (
          <circle key={index} cx={cx} cy={cy} r="11" fill={fill} opacity="0.72" />
        ))}
      </svg>
      <span className="brand-name">efficient hypothesis</span>
    </div>
  );
}
