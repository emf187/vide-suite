/**
 * Suite logo (M13 direction): the shared Cogitex brand mark replaces the retired
 * 16×16 pixel mascot, so VIDE CORTEX reads as part of the Cogitex suite family.
 */
export function SuiteLogo({ size = 30 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static private-mark asset; next/image adds nothing here
    <img
      src="/img/brand-mark.png"
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-md object-contain"
      draggable={false}
    />
  );
}
