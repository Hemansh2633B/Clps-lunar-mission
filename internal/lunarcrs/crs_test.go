package lunarcrs

import (
	"testing"
)

func TestLunar(t *testing.T) {
	c := Local(-89.5, 45, 1737400)
	x, y, err := c.Forward(45, -89.5)
	if err != nil || x != 0 || y != 0 {
		t.Fatal(x, y, err)
	}
	lon, lat, err := c.Inverse(3000, 4000)
	if err != nil {
		t.Fatal(err)
	}
	t.Log(lon, lat)
}
