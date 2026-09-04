//go:build linux

package main

import (
	"os"
	"strconv"
	"strings"
	"syscall"
)

func readMachineSample() machineSample {
	s := machineSample{}
	var usage syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) == nil {
		s.cpuKnown = true
		s.cpuSeconds = float64(usage.Utime.Sec+usage.Stime.Sec) + float64(usage.Utime.Usec+usage.Stime.Usec)/1e6
	}
	nodeProcesses.Lock()
	s.cpuSeconds += nodeProcesses.retiredCPU
	var childRSS uint64
	for pid := range nodeProcesses.pids {
		prefix := "/proc/" + strconv.Itoa(pid)
		if data, err := os.ReadFile(prefix + "/stat"); err == nil {
			text := string(data)
			end := strings.LastIndexByte(text, ')')
			if end >= 0 {
				fields := strings.Fields(text[end+1:])
				if len(fields) > 12 {
					u, _ := strconv.ParseFloat(fields[11], 64)
					k, _ := strconv.ParseFloat(fields[12], 64)
					nodeProcesses.lastCPU[pid] = (u + k) / 100
				}
			}
		}
		s.cpuSeconds += nodeProcesses.lastCPU[pid]
		if data, err := os.ReadFile(prefix + "/statm"); err == nil {
			fields := strings.Fields(string(data))
			if len(fields) > 1 {
				pages, _ := strconv.ParseUint(fields[1], 10, 64)
				childRSS += pages * uint64(os.Getpagesize())
			}
		}
	}
	nodeProcesses.Unlock()
	for _, file := range []string{"/proc/self/status", "/proc/meminfo"} {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			value, _ := strconv.ParseUint(fields[1], 10, 64)
			switch fields[0] {
			case "VmRSS:":
				s.rss = value * 1024
			case "MemTotal:":
				s.total = value * 1024
			case "MemAvailable:":
				s.available = value * 1024
			}
		}
	}
	if data, err := os.ReadFile("/proc/stat"); err == nil {
		line := strings.SplitN(string(data), "\n", 2)[0]
		fields := strings.Fields(line)
		for i := 1; i < len(fields) && i <= 8; i++ {
			v, _ := strconv.ParseUint(fields[i], 10, 64)
			s.hostTotal += v
			if i == 4 || i == 5 {
				s.hostIdle += v
			}
		}
	}
	s.rss += childRSS
	return s
}
