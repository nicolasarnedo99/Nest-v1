# Company marks

Nest shows a flat, one-colour mark for each company it can invest in. The marks are not files here: each is one SVG path in `mobile/lib/logos.ts`, drawn with `react-native-svg` in a 24×24 viewBox. This note records where each came from.

All nine come from [Simple Icons](https://simpleicons.org) **12.4.0** (npm `simple-icons@12.4.0`, June 2024), whose path data is released under CC0 1.0. Simple Icons removed Microsoft in 13.0.0, Amazon in 15.0.0 and Walmart in 16.0.0, most likely at the owners' request, so 12.4.0 is the last release that has all of them. The file was written by the one-off script in the WS9 plan (Task 2), from `https://cdn.jsdelivr.net/npm/simple-icons@12.4.0/icons/<slug>.svg`.

CC0 covers the path data, not the brands. Every mark is a trademark of its owner, and several owners' guidelines restrict use. **Keep the marks out of public material (videos, posts, the site) until they have been reviewed**, Microsoft, Amazon and Walmart first.

| Company | Simple Icons slug | Owner's source, as Simple Icons records it | Slice colour |
|---|---|---|---|
| Apple | `apple` | https://www.apple.com | `#1D1D1F` |
| Alphabet | `google` (Alphabet has no mark of its own in Simple Icons; this is Google's "G") | https://partnermarketinghub.withgoogle.com | `#4285F4` |
| Microsoft | `microsoft` | https://developer.microsoft.com | `#737373` |
| Tesla | `tesla` | https://www.tesla.com/tesla-gallery | `#CC0000` |
| NVIDIA | `nvidia` | https://www.nvidia.com/en-us | `#76B900` |
| Amazon | `amazon` | https://www.amazon.com | `#FF9900` |
| Walmart | `walmart` | https://corporate.walmart.com | `#FFC220` |
| Uber | `uber` | https://assets.uber.com/d/k4nuxdZ8MC7E/logos/collection/151 | `#06C167` |
| Starbucks | `starbucks` | https://starbucks.com | `#006241` |

The slice colours are each company's own brand colours, picked so any two differ clearly on white (CIE76 ΔE of at least 20, checked by `tests/mobile/logos.test.ts`). Walmart uses its spark yellow because its blue sat too close to Google's; Uber uses its Eats green because its black sat too close to Apple's; Microsoft uses its logo grey.

Adding a company to `stocks` in `mobile/turtle.config.json` fails the test until it has a mark, a colour and a row here.
