import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import './CardNav.css';

// Wafer-adapted CardNav (React Bits). Differences from the upstream component:
// - links route via onClick (SPA tab switch) instead of <a href>, and close the menu;
// - the logo is the Wafer glyph + wordmark (onLogoClick -> home);
// - the right slot renders a passed `cta` node (a static network chip here — the
//   account menu lives top-right, outside this overflow:hidden nav, so its dropdown
//   isn't clipped);
// - the arrow icon is inline SVG (no react-icons dependency).

function ArrowIcon() {
  return (
    <svg className="nav-card-link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17L17 7M17 7H8.5M17 7V15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WaferGlyph() {
  return (
    <svg className="cn-logo-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><clipPath id="cn-wfr"><circle cx="12" cy="12" r="9" /></clipPath></defs>
      <g clipPath="url(#cn-wfr)" stroke="currentColor" strokeWidth="0.9" opacity="0.45">
        <path d="M8 1 V23 M12 1 V23 M16 1 V23 M1 8 H23 M1 12 H23 M1 16 H23" />
      </g>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="3.5" r="0.95" fill="currentColor" />
    </svg>
  );
}

const CardNav = ({
  items,
  cta,
  onLogoClick,
  className = '',
  ease = 'power3.out',
  baseColor = '#12283A',
  menuColor = '#F4EEE3'
}) => {
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const navRef = useRef(null);
  const cardsRef = useRef([]);
  const tlRef = useRef(null);

  const calculateHeight = () => {
    const navEl = navRef.current;
    if (!navEl) return 260;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      const contentEl = navEl.querySelector('.card-nav-content');
      if (contentEl) {
        const wasVisible = contentEl.style.visibility;
        const wasPointerEvents = contentEl.style.pointerEvents;
        const wasPosition = contentEl.style.position;
        const wasHeight = contentEl.style.height;

        contentEl.style.visibility = 'visible';
        contentEl.style.pointerEvents = 'auto';
        contentEl.style.position = 'static';
        contentEl.style.height = 'auto';

        contentEl.offsetHeight;

        const topBar = 60;
        const padding = 16;
        const contentHeight = contentEl.scrollHeight;

        contentEl.style.visibility = wasVisible;
        contentEl.style.pointerEvents = wasPointerEvents;
        contentEl.style.position = wasPosition;
        contentEl.style.height = wasHeight;

        return topBar + contentHeight + padding;
      }
    }
    return 260;
  };

  const createTimeline = () => {
    const navEl = navRef.current;
    if (!navEl) return null;

    gsap.set(navEl, { height: 60, overflow: 'hidden' });
    gsap.set(cardsRef.current, { y: 50, opacity: 0 });

    const tl = gsap.timeline({ paused: true });

    tl.to(navEl, { height: calculateHeight, duration: 0.4, ease });
    tl.to(cardsRef.current, { y: 0, opacity: 1, duration: 0.4, ease, stagger: 0.08 }, '-=0.1');

    return tl;
  };

  useLayoutEffect(() => {
    const tl = createTimeline();
    tlRef.current = tl;
    return () => {
      tl?.kill();
      tlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ease, items]);

  useLayoutEffect(() => {
    const handleResize = () => {
      if (!tlRef.current) return;
      if (isExpanded) {
        const newHeight = calculateHeight();
        gsap.set(navRef.current, { height: newHeight });
        tlRef.current.kill();
        const newTl = createTimeline();
        if (newTl) {
          newTl.progress(1);
          tlRef.current = newTl;
        }
      } else {
        tlRef.current.kill();
        const newTl = createTimeline();
        if (newTl) tlRef.current = newTl;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  const closeMenu = () => {
    const tl = tlRef.current;
    setIsHamburgerOpen(false);
    if (tl && isExpanded) {
      tl.eventCallback('onReverseComplete', () => setIsExpanded(false));
      tl.reverse();
    } else {
      setIsExpanded(false);
    }
  };

  const toggleMenu = () => {
    const tl = tlRef.current;
    if (!tl) return;
    if (!isExpanded) {
      setIsHamburgerOpen(true);
      setIsExpanded(true);
      tl.play(0);
    } else {
      setIsHamburgerOpen(false);
      tl.eventCallback('onReverseComplete', () => setIsExpanded(false));
      tl.reverse();
    }
  };

  const setCardRef = i => el => {
    if (el) cardsRef.current[i] = el;
  };

  const handleLink = lnk => {
    lnk.onClick?.();
    closeMenu();
  };

  return (
    <div className={`card-nav-container ${className}`}>
      <nav ref={navRef} className={`card-nav ${isExpanded ? 'open' : ''}`} style={{ backgroundColor: baseColor }}>
        <div className="card-nav-top">
          <div
            className={`hamburger-menu ${isHamburgerOpen ? 'open' : ''}`}
            onClick={toggleMenu}
            role="button"
            aria-label={isExpanded ? 'Close menu' : 'Open menu'}
            tabIndex={0}
            style={{ color: menuColor }}
          >
            <div className="hamburger-line" />
            <div className="hamburger-line" />
          </div>

          <button type="button" className="logo-container" onClick={onLogoClick} aria-label="Wafer — home">
            <span className="cn-logo"><WaferGlyph /></span>
            <span className="cn-wordmark">Wafer</span>
          </button>

          <div className="card-nav-cta">{cta}</div>
        </div>

        <div className="card-nav-content" aria-hidden={!isExpanded}>
          {(items || []).slice(0, 3).map((item, idx) => (
            <div
              key={`${item.label}-${idx}`}
              className="nav-card"
              ref={setCardRef(idx)}
              style={{ backgroundColor: item.bgColor, color: item.textColor }}
            >
              <div className="nav-card-label">{item.label}</div>
              <div className="nav-card-links">
                {item.links?.map((lnk, i) => (
                  <button
                    key={`${lnk.label}-${i}`}
                    type="button"
                    className="nav-card-link"
                    onClick={() => handleLink(lnk)}
                    aria-label={lnk.ariaLabel}
                  >
                    <ArrowIcon />
                    {lnk.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
};

export default CardNav;
