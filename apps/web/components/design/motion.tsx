"use client";

import { motion, type HTMLMotionProps, type Variants } from "framer-motion";
import type { ReactNode } from "react";

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};


export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
};


type MotionDivProps = HTMLMotionProps<"div"> & {
  children: ReactNode;
};

export function FadeUp({
  children,
  className,
  delay = 0,
  ...props
}: MotionDivProps & { delay?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={fadeUp}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className,
  ...props
}: MotionDivProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={staggerContainer}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  ...props
}: MotionDivProps) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

