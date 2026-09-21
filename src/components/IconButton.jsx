export function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  badge,
  className = "",
  type = "button",
}) {
  return (
    <button
      type={type}
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={20} strokeWidth={1.9} />
      {badge ? <span className="icon-button__badge">{badge}</span> : null}
    </button>
  );
}
