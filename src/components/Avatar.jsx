export function Avatar({
  src,
  name = "?",
  size = 48,
  accent = "#ef6a5b",
  online = false,
  className = "",
}) {
  const initial = name.trim().slice(0, 1);

  return (
    <span
      className={`avatar ${className}`}
      style={{
        "--avatar-size": `${size}px`,
        "--avatar-accent": accent,
      }}
    >
      <span className="avatar__fallback">{initial}</span>
      {src ? (
        <img
          src={src}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      {online ? <span className="avatar__online" /> : null}
    </span>
  );
}
