#  CLPS Lunar Mission Browser

> **NASA Space Apps Challenge 2026** 

Hey there! This is our project for the 2026 NASA Space Apps Challenge. We will build a visual browser tool to help team members, educators, and anyone interested in space quickly figure out where and when to land payloads on the Moon’s South Pole.

Instead of messing around with messy datasets and hard-to-read command-line tools, our app gives you quick visual answers for **solar power availability** and **direct communications back to Earth**.

##  What’s the big deal with the Lunar South Pole?

Landing on the Moon's South Pole is super tricky. The Sun stays really low on the horizon, creating massive, dark shadows across craters. If your lander goes into a shadow, its solar panels die. Plus, the Moon's wobble (libration) means Earth frequently dips below the local mountains, cutting off radio contact.

Our tool lets you pick spots and dates to quickly check:

1. **Can we get solar power?** (Is the Sun above the mountains?)

2. **Can we talk to Earth?** (Is Earth visible in the sky?)

##  Data Sources We Used

We will pull together data from different space agencies across the globe so our calculations actually make sense:

* **NASA:**

  * **LRO / LOLA Data:** Digital Elevation Models (DEM) for South Pole lunar surface heights and crater walls.

  * **JPL HORIZONS API:** For exact positioning of the Sun and Earth relative to any spot on the Moon.

* **ISRO (India):**

  * **Chandrayaan-2 / Chandrayaan-3:** High-resolution camera imagery (OHRC) and terrain mapping to give context to potential landing spots.

* **ESA (Europe):**

  * **Planetary Science Archive (PSA):** SMART-1 and GIS layers for validation and photometric surface maps.

## What the tool actually does

* **Pick a Landing Zone:** Choose from well-known NASA CLPS target areas like Shackleton Rim or Malapert Mountain, or type in your own coordinates near the pole.

* **Skyplot View:** A simple visual display showing the path of the Sun (yellow) and Earth (blue) relative to the local terrain profile.

* **Uptime Timelines:** Easy-to-read charts showing exact windows when you have both power AND comms.

* **Compare Sites Side-by-Side:** Place two candidate landing sites next to each other to see which one gives your mission more operational days.
