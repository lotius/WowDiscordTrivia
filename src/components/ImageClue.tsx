import { useEffect, useState } from "react";
import { assetUrl } from "../environment";

export function ImageClue({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const resolved = assetUrl(src);

  useEffect(() => {
    const image = new Image();
    image.src = resolved;
  }, [resolved]);

  return (
    <>
      <button className="image-clue" onClick={() => setOpen(true)} aria-label="Open image clue">
        <img src={resolved} alt={alt} />
        <span>⌕ Enlarge</span>
      </button>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <button onClick={() => setOpen(false)} aria-label="Close image">×</button>
          <img src={resolved} alt={alt} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
