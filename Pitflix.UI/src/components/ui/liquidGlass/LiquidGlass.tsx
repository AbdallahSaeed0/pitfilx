import { useRef, type CSSProperties, type HTMLAttributes } from "react";
import { cn } from "../../../utils/cn";
import { useLiquidGlass, type LiquidGlassOptions } from "./useLiquidGlass";

type Props = HTMLAttributes<HTMLDivElement> &
  LiquidGlassOptions & {
    /** Extra classes only while liquid glass is active (usually a more see-through tint). */
    glassClassName?: string;
    /** Extra classes when it isn't (the original frosted look). */
    fallbackClassName?: string;
    glassStyle?: CSSProperties;
    fallbackStyle?: CSSProperties;
  };

/** A `<div>` that renders as liquid glass when enabled and supported, else as its usual frosted panel. */
export function LiquidGlass({
  radius,
  bezel,
  strength,
  blur,
  saturation,
  className,
  glassClassName,
  fallbackClassName,
  style,
  glassStyle,
  fallbackStyle,
  children,
  ...rest
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(ref, { radius, bezel, strength, blur, saturation });
  return (
    <div
      ref={ref}
      className={cn(className, glass.active ? cn("liquid-glass", glassClassName) : fallbackClassName)}
      style={{ ...style, ...(glass.active ? { ...glassStyle, ...glass.style } : fallbackStyle) }}
      {...rest}
    >
      {glass.filter}
      {children}
    </div>
  );
}
