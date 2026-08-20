"""Dynamic duration and experience scoring for journeys."""

from __future__ import annotations

from typing import Any

BASE_SPEED_MPH = 3.0
STOP_DURATION_MINUTES = 5.0
VIEWPOINT_DURATION_MINUTES = 10.0

def calculate_duration_minutes(distance_miles: float, elevation_change_ft: float, stops: list[dict[str, Any]]) -> int:
    """Calculate realistic walking duration including stops and terrain."""
    base_minutes = (distance_miles / BASE_SPEED_MPH) * 60
    
    # Add time for elevation (Naismith's rule roughly: +30 mins per 1000 ft)
    elevation_minutes = (elevation_change_ft / 1000.0) * 30 if elevation_change_ft > 0 else 0
    
    # Add time for stops (POIs, viewpoints, rest areas)
    stop_minutes = 0
    for stop in stops:
        stop_type = stop.get("type", "generic")
        if stop_type in ["viewpoint", "historic_site"]:
            stop_minutes += VIEWPOINT_DURATION_MINUTES
        else:
            stop_minutes += STOP_DURATION_MINUTES
            
    total_minutes = base_minutes + elevation_minutes + stop_minutes
    return int(round(total_minutes))

def rank_chapters(chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rank journey chapters based on POI density, amenities, and loop possibilities."""
    for chapter in chapters:
        score = 0
        score += len(chapter.get("stops", [])) * 10
        score += 20 if chapter.get("is_loop") else 0
        score += len(chapter.get("amenities", [])) * 5
        chapter["experience_score"] = score
        
    return sorted(chapters, key=lambda c: c["experience_score"], reverse=True)
