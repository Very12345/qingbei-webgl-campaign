//go:build !linux

package main

// Heap and tick metrics remain portable; unavailable OS metrics are explicit
// null/zero fields rather than invented CPU/RSS measurements.
func readMachineSample() machineSample { return machineSample{} }
