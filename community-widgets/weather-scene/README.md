# Weather scene

The current weather as an animated scene that follows the weather, the time of day and the season: sun or moon on
its arc, drifting clouds, rain, snow, fog or lightning, stars and the moon's phase at night, and hills and a tree that
change with spring, summer, autumn and winter. The temperature, today's high and low, and optionally the wind and
humidity sit on top.

Set the place (a city, or `lat,lon`), the units and how often it refreshes from the panel's cog. **Weather shown**,
**Time shown** and **Season shown** draw a fixed scene instead of the live one, to preview them. Animations pause for
anyone who asks for reduced motion.

Everything it says is in `locales/`, in English, Lithuanian, Spanish and French: the conditions, the readings, and
the words the cog itself shows, which are label keys in `widget.json` so they follow the user's language too. A
language Thingport has that the widget hasn't falls back to English, key by key.

It calls two [Open-Meteo](https://open-meteo.com) services, which need no API key:

- `geocoding-api.open-meteo.com`, to find the city's coordinates (skipped when you give `lat,lon`).
- `api.open-meteo.com`, for the current weather, today's sunrise and sunset, and the high and low.
