import { httpClient } from './httpClient.js';

export const getAirports = () => httpClient.request('/airports');
export const getAirport = (slug) => httpClient.request(`/airports/${encodeURIComponent(slug)}`);
export const getAirportMap = (slug, options) => httpClient.request(`/airports/${encodeURIComponent(slug)}/map`, options);
