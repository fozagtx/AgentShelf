import { motion, useInView, useMotionValue, useTransform, animate, type Variants } from "motion/react";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";

export const EASE = [0.006, 0.557, 0.25, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

export function Stagger({ children, className, gap = 0.08, delay = 0, inView = true }: { children: ReactNode; className?: string; gap?: number; delay?: number; inView?: boolean }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      {...(inView ? { whileInView: "show", viewport: { once: true, margin: "-60px" } } : { animate: "show" })}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function Item({ children, ...props }: ComponentProps<typeof motion.div> & { children: ReactNode }) {
  return <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-40px" }} {...props}>{children}</motion.div>;
}

export function Words({ text, className }: { text: string; className?: string }) {
  return (
    <motion.h1 className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
      {text.split(" ").map((w, i) => (
        <motion.span key={i} style={{ display: "inline-block", whiteSpace: "pre" }} variants={fadeUp}>{w + " "}</motion.span>
      ))}
    </motion.h1>
  );
}

export function CountUp({ to, from = 0, suffix = "", decimals = 0 }: { to: number; from?: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const v = useMotionValue(from);
  const text = useTransform(v, (n) => `${n.toFixed(decimals)}${suffix}`);
  useEffect(() => {
    if (!seen) return;
    const c = animate(v, to, { duration: 1.2, ease: EASE });
    return () => c.stop();
  }, [seen, to, v]);
  return <motion.span ref={ref}>{text}</motion.span>;
}

export const hoverCard = {
  whileHover: { y: -3, transition: { duration: 0.2, ease: EASE } },
  whileTap: { scale: 0.985 },
};
