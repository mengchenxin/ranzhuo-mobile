import { X } from "lucide-react";
import { IconButton } from "./IconButton";

export function Sheet({ title, eyebrow, onClose, children, footer, variant = "" }) {
  return (
    <div className="sheet-layer" role="presentation">
      <button
        type="button"
        className="sheet-scrim"
        onClick={onClose}
        aria-label="关闭"
      />
      <section className={`sheet ${variant ? `sheet--${variant}` : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__handle" />
        <header className="sheet__header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2>{title}</h2>
          </div>
          <IconButton icon={X} label="关闭" onClick={onClose} />
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
