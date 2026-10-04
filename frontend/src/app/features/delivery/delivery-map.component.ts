import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { environment } from '../../../environments/environment';
import { Coordinate } from './delivery-api.service';
export interface MapPoint extends Coordinate {
  label: string;
  kind: 'employee' | 'destination';
  accuracy?: number;
}
@Component({
  selector: 'app-delivery-map',
  template: `<div class="map-tools">
      <span>© OpenStreetMap contributors</span
      ><button type="button" (click)="fit()">Fit markers</button>
    </div>
    <div #canvas class="map" role="region" aria-label="Delivery location map"></div>
    @if (failed()) {
      <p role="status">Map tiles unavailable. Address and delivery status remain available.</p>
    }
    @if (editable) {
      <p>Click the map to place a destination pin, or enter coordinates below.</p>
    }`,
  styleUrl: './delivery-map.scss',
  encapsulation: ViewEncapsulation.None,
})
export class DeliveryMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() points: MapPoint[] = [];
  @Input() editable = false;
  @Input() follow = true;
  @Output() pin = new EventEmitter<Coordinate>();
  @ViewChild('canvas') canvas!: ElementRef<HTMLElement>;
  readonly failed = signal(false);
  private map?: Leaflet.Map;
  private L?: typeof Leaflet;
  private layer?: Leaflet.LayerGroup;
  private destroyed = false;
  async ngAfterViewInit() {
    try {
      const L = await import('leaflet/dist/leaflet-src.esm.js');
      if (this.destroyed) return;
      this.L = L;
      const cfg = environment.deliveryMap;
      this.map = L.map(this.canvas.nativeElement).setView(cfg.center as [number, number], cfg.zoom);
      this.layer = L.layerGroup().addTo(this.map);
      L.tileLayer(cfg.tileUrl, { attribution: cfg.attribution, maxZoom: 19 })
        .on('tileerror', () => this.failed.set(true))
        .addTo(this.map);
      this.map.on('click', (e) => {
        if (this.editable) this.pin.emit({ latitude: e.latlng.lat, longitude: e.latlng.lng });
      });
      this.draw();
      this.fit();
    } catch {
      this.failed.set(true);
    }
  }
  ngOnChanges() {
    this.draw();
  }
  private draw() {
    if (!this.L || !this.layer) return;
    this.layer.clearLayers();
    for (const p of this.points) {
      const label = document.createElement('span');
      label.textContent = p.label;
      this.L.marker([p.latitude, p.longitude], {
        icon: this.L.divIcon({
          html:
            p.kind === 'employee'
              ? '<span class="delivery-map-marker employee">●</span>'
              : '<span class="delivery-map-marker destination">◆</span>',
          className: 'delivery-map-icon',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        alt: p.label,
      })
        .bindTooltip(label)
        .addTo(this.layer);
      if (p.accuracy !== undefined)
        this.L.circle([p.latitude, p.longitude], {
          radius: p.accuracy,
          color: '#465fff',
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(this.layer);
    }
    if (this.follow) this.fit();
  }
  fit() {
    if (this.L && this.map && this.points.length)
      this.map.fitBounds(
        this.L.latLngBounds(this.points.map((p) => [p.latitude, p.longitude] as [number, number])),
        { padding: [30, 30], maxZoom: 15 },
      );
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.map?.remove();
  }
}
