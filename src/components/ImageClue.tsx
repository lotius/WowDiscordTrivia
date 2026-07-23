import { useEffect, useState } from "react";

export function ImageClue({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.src = src;
  }, [src]);

  return (
    <>
      <button className="image-clue" onClick={() => setOpen(true)} aria-label="Open image clue">
        <img src={src} alt={alt} />
        <span>⌕ Enlarge</span>
      </button>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <button onClick={() => setOpen(false)} aria-label="Close image">×</button>
          <img src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
