package main

func (s *hubServer) queueFor(pace string) **queueEntry {
	if pace == "blitz" {
		return &s.waitingBlitz
	}
	return &s.waiting
}

func (s *hubServer) clearUserQueuesLocked(id string) {
	for _, queue := range []**queueEntry{&s.waiting, &s.waitingBlitz} {
		if *queue != nil && (*queue).UserID == id {
			*queue = nil
		}
	}
}
