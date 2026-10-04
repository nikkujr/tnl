export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
  deliveryMap: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    center: [12.8797, 121.7740], zoom: 5,
  },
};
