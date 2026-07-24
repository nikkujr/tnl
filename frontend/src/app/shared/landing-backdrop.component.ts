import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';

type Point = { x: number; y: number; size: number; depth: number; phase: number };

@Component({
  selector: 'app-landing-backdrop',
  standalone: true,
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [`
    :host { position:absolute;z-index:0;inset:0;overflow:hidden;pointer-events:none }
    canvas { width:100%;height:100%;display:block;opacity:.96 }
  `]
})
export class LandingBackdropComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  private readonly zone = inject(NgZone);
  private readonly points: Point[] = [];
  private readonly pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  private resizeObserver?: ResizeObserver;
  private frame = 0;
  private width = 0;
  private height = 0;
  private reducedMotion = false;

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvasRef.nativeElement.parentElement!);
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      this.resize();
      this.frame = requestAnimationFrame(this.render);
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    window.removeEventListener('pointermove', this.onPointerMove);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointer.targetX = event.clientX / Math.max(window.innerWidth, 1) - .5;
    this.pointer.targetY = event.clientY / Math.max(window.innerHeight, 1) - .5;
    if (this.reducedMotion) this.draw(0);
  };

  private resize(): void {
    const canvas = this.canvasRef.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.width = bounds.width;
    this.height = bounds.height;
    canvas.width = Math.round(this.width * ratio);
    canvas.height = Math.round(this.height * ratio);
    canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.createPoints();
    this.draw(0);
  }

  private createPoints(): void {
    this.points.length = 0;
    const count = Math.max(22, Math.min(52, Math.round(this.width / 28)));
    for (let index = 0; index < count; index++) {
      const seed = index * 12.9898;
      const random = (offset: number) => Math.abs(Math.sin(seed + offset) * 43758.5453) % 1;
      this.points.push({
        x: random(1) * this.width, y: random(2) * this.height,
        size: 1.2 + random(3) * 2, depth: .25 + random(4) * .75,
        phase: random(5) * Math.PI * 2
      });
    }
  }

  private readonly render = (time: number): void => {
    this.pointer.x += (this.pointer.targetX - this.pointer.x) * .045;
    this.pointer.y += (this.pointer.targetY - this.pointer.y) * .045;
    this.draw(time);
    if (!this.reducedMotion) this.frame = requestAnimationFrame(this.render);
  };

  private draw(time: number): void {
    const context = this.canvasRef.nativeElement.getContext('2d');
    if (!context || !this.width || !this.height) return;
    context.clearRect(0, 0, this.width, this.height);
    const positions = this.points.map((point) => ({
      ...point,
      px: point.x + this.pointer.x * 62 * point.depth + Math.sin(time * .00022 + point.phase) * 7,
      py: point.y + this.pointer.y * 44 * point.depth + Math.cos(time * .00018 + point.phase) * 6
    }));

    const cursorX = this.width * (.5 + this.pointer.x);
    const cursorY = this.height * (.5 + this.pointer.y);
    const glow = context.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, 170);
    glow.addColorStop(0, 'rgba(70,95,255,.16)');
    glow.addColorStop(.45, 'rgba(128,152,255,.08)');
    glow.addColorStop(1, 'rgba(70,95,255,0)');
    context.fillStyle = glow;
    context.fillRect(cursorX - 170, cursorY - 170, 340, 340);

    context.lineWidth = 1;
    for (let first = 0; first < positions.length; first++) {
      for (let second = first + 1; second < positions.length; second++) {
        const distance = Math.hypot(positions[first].px - positions[second].px, positions[first].py - positions[second].py);
        if (distance > 175) continue;
        context.strokeStyle = `rgba(70,95,255,${(1 - distance / 175) * .24})`;
        context.beginPath();
        context.moveTo(positions[first].px, positions[first].py);
        context.lineTo(positions[second].px, positions[second].py);
        context.stroke();
      }
    }
    for (const point of positions) {
      context.fillStyle = `rgba(70,95,255,${.28 + point.depth * .34})`;
      context.beginPath();
      context.arc(point.px, point.py, point.size, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = 'rgba(70,95,255,.5)';
    context.beginPath();
    context.arc(cursorX, cursorY, 3.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(70,95,255,.2)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cursorX, cursorY, 15 + Math.sin(time * .003) * 2, 0, Math.PI * 2);
    context.stroke();

    this.drawCube(context, this.width * .11 + this.pointer.x * 38, this.height * .22 + this.pointer.y * 28, 58, time * .00016);
    this.drawCube(context, this.width * .84 + this.pointer.x * 68, this.height * .7 + this.pointer.y * 48, 84, -time * .00012);
    this.drawCube(context, this.width * .69 + this.pointer.x * 30, this.height * .15 + this.pointer.y * 22, 42, time * .0002);
  }

  private drawCube(context: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number): void {
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const project = (px: number, py: number, pz: number) => {
      const rx = px * cosine - pz * sine;
      const rz = px * sine + pz * cosine;
      return { x: x + rx + rz * .45, y: y + py - rz * .28 };
    };
    const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
      .map(([px, py, pz]) => project(px * size / 2, py * size / 2, pz * size / 2));
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    context.strokeStyle = 'rgba(101,91,184,.34)';
    context.lineWidth = 1.6;
    for (const [from, to] of edges) {
      context.beginPath();
      context.moveTo(vertices[from].x, vertices[from].y);
      context.lineTo(vertices[to].x, vertices[to].y);
      context.stroke();
    }
  }
}
