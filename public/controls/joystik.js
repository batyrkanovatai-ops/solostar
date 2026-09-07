// Модуль управления с поддержкой мультитача (одновременная ходьба и стрельба)
class ControlManager {
    constructor(onMove, onAttack) {
        this.onMove = onMove;
        this.onAttack = onAttack;
        this.touchId = null;
        this.startX = 0;
        this.startY = 0;

        this.initJoystick();
        this.initAttackButton();
    }

    initJoystick() {
        const zone = document.getElementById('joystick-zone');
        const stick = document.getElementById('joystick-stick');
        if (!zone || !stick) return;

        const maxRadius = 40;

        const handleTouchStart = (e) => {
            // Берем только новое касание, относящееся к зоне джойстика
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (this.touchId === null) {
                    this.touchId = touch.identifier;
                    const rect = zone.getBoundingClientRect();
                    this.startX = rect.left + rect.width / 2;
                    this.startY = rect.top + rect.height / 2;
                    break;
                }
            }
        };

        const handleTouchMove = (e) => {
            if (this.touchId === null) return;

            // Находим палец, который держит джойстик (не отвлекаясь на палец атаки)
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                if (touch.identifier === this.touchId) {
                    let dx = touch.clientX - this.startX;
                    let dy = touch.clientY - this.startY;
                    let dist = Math.hypot(dx, dy);

                    if (dist > maxRadius) {
                        dx = (dx / dist) * maxRadius;
                        dy = (dy / dist) * maxRadius;
                    }

                    stick.style.transform = `translate(${dx}px, ${dy}px)`;
                    this.onMove(dx / maxRadius, dy / maxRadius);
                    break;
                }
            }
        };

        const handleTouchEnd = (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchId) {
                    this.touchId = null;
                    stick.style.transform = 'translate(0px, 0px)';
                    this.onMove(0, 0);
                    break;
                }
            }
        };

        zone.addEventListener('touchstart', handleTouchStart, { passive: false });
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd, { passive: false });
        window.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    }

    initAttackButton() {
        const attackBtn = document.getElementById('attack-btn');
        if (!attackBtn) return;

        // Обработка клика/касания кнопки атаки независимо от джойстика
        attackBtn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Предотвращает задержку и сброс джойстика
            this.onAttack();
        }, { passive: false });
    }
}
