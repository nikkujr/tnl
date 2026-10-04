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
      <span class="map-legend"
        ><span class="destination-key">◆</span> Destination ·
        <span class="employee-key">●</span> Employee</span
      >
      <div>
        @if (editable) {
          <button type="button" class="primary" (click)="placePin()">Place destination pin</button>
        }
        <button type="button" (click)="fit()">Show all markers</button>
      </div>
    </div>
    <div #canvas class="map" role="region" aria-label="Delivery location map"></div>
    @if (failed()) {
      <p role="status">Map tiles unavailable. Address and delivery status remain available.</p>
    }
    @if (editable) {
      <p>
        Tap the map or drag the destination marker to adjust it. Choose Save destination to apply
        your changes.
      </p>
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
  private markers = new Map<string, Leaflet.Marker>();
  private dragging = false;
  private destroyed = false;
  private resize?: ResizeObserver;
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
      this.resize = new ResizeObserver(() => {
        this.map?.invalidateSize();
        if (!this.dragging) this.fit();
      });
      this.resize.observe(this.canvas.nativeElement);
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
    if (!this.L || !this.layer || !this.map) return;
    this.layer.clearLayers();
    const keys = new Set<string>();
    for (const [index, p] of this.points.entries()) {
      const key = `${p.kind}:${index}`;
      keys.add(key);
      const label = document.createElement('span');
      label.textContent = p.label;
      let marker = this.markers.get(key);
      if (!marker) {
        marker = this.L.marker([p.latitude, p.longitude], {
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
          title: p.label,
          draggable: this.editable && p.kind === 'destination',
        })
          .bindTooltip(label, {
            permanent: p.kind === 'destination',
            direction: 'top',
            offset: [0, -14],
          })
          .addTo(this.map);
        this.markers.set(key, marker);
        marker.on('dragstart', () => {
          this.dragging = true;
        });
        marker.on('dragend', () => {
          this.dragging = false;
          const p = marker!.getLatLng();
          this.pin.emit({ latitude: p.lat, longitude: p.lng });
        });
      } else {
        if (!this.dragging || p.kind !== 'destination') marker.setLatLng([p.latitude, p.longitude]);
        marker.setTooltipContent(label);
        const element = marker.getElement();
        if (element) element.title = p.label;
        if (this.editable && p.kind === 'destination') marker.dragging?.enable();
        else marker.dragging?.disable();
      }
      if (p.accuracy !== undefined)
        this.L.circle([p.latitude, p.longitude], {
          radius: p.accuracy,
          color: '#465fff',
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(this.layer);
    }
    for (const [key, marker] of this.markers) {
      if (!keys.has(key)) {
        marker.remove();
        this.markers.delete(key);
      }
    }
    if (this.follow && !this.dragging) this.fit();
  }
  fit() {
    if (this.L && this.map && this.points.length)
      this.map.fitBounds(
        this.L.latLngBounds(this.points.map((p) => [p.latitude, p.longitude] as [number, number])),
        { padding: [30, 30], maxZoom: 15 },
      );
  }
  focusPoint(point: Coordinate) {
    this.map?.setView([point.latitude, point.longitude], 15);
  }
  placePin() {
    if (!this.editable || !this.map) return;
    const center = this.map.getCenter();
    this.pin.emit({ latitude: center.lat, longitude: center.lng });
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.resize?.disconnect();
    this.map?.remove();
  }
}
