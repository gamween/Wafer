import React, { useRef, useState } from "react";
import "./FileUpload.css";

// Lightweight drag-and-drop file upload (plain CSS/JS, no deps). Used for an
// optional deal illustration; the parent shows a fallback (category logo) when
// nothing is uploaded via the `preview` prop.
export default function FileUpload({ onChange, accept = "image/*", preview, hint }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const take = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onChange?.(files);
  };

  return (
    <div
      className={`fu${drag ? " fu-drag" : ""}${preview ? " fu-has" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
    >
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => take(e.target.files)} />
      {preview ? (
        <img className="fu-preview" src={preview} alt="" />
      ) : (
        <div className="fu-empty">
          <svg className="fu-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span className="fu-title">Drop an illustration or click to upload</span>
          <span className="fu-sub">{hint || "PNG / JPG — optional; the category logo is used otherwise"}</span>
        </div>
      )}
    </div>
  );
}
