"use client";

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import BookingForm from "./BookingForm";

export default function HomeClient({ html }) {
  useEffect(() => {
    const cleanupFns = [];
    const yearEl = document.getElementById("year");
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }

    // Navbar toggle
    const navbar = document.querySelector(".navbar");
    const navToggle = document.querySelector(".nav-toggle");
    const navLinks = document.querySelector(".nav-links");

    const closeMenu = () => {
      if (navbar && navToggle) {
        navbar.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    };

    if (navToggle && navLinks && navbar) {
      const handleToggle = () => {
        const isOpen = navbar.classList.toggle("open");
        navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      };

      const handleOutsideClick = (e) => {
        if (!navbar.contains(e.target)) {
          closeMenu();
        }
      };

      navToggle.addEventListener("click", handleToggle);
      cleanupFns.push(() => navToggle.removeEventListener("click", handleToggle));

      navLinks.querySelectorAll("a, button").forEach((el) => {
        const handler = () => closeMenu();
        el.addEventListener("click", handler);
        cleanupFns.push(() => el.removeEventListener("click", handler));
      });

      document.addEventListener("click", handleOutsideClick);
      cleanupFns.push(() => document.removeEventListener("click", handleOutsideClick));
    }

    // Reveal animations
    const revealEls = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      revealEls.forEach((el, idx) => {
        setTimeout(() => el.classList.add("show"), idx * 90);
      });
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const delay = parseFloat(entry.target.dataset.revealDelay || "0");
              entry.target.style.transitionDelay = `${delay}s`;
              entry.target.classList.add("show");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -5% 0px" }
      );

      revealEls.forEach((el) => observer.observe(el));
      cleanupFns.push(() => observer.disconnect());
    }

    // Mount React booking form into placeholder
    const bookingMount = document.getElementById("booking-react-root");
    if (bookingMount) {
      const root = createRoot(bookingMount);
      root.render(<BookingForm />);
      cleanupFns.push(() => root.unmount());
    }

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
