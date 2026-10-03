"""Validate national discovery seeds and generate deterministic research artifacts."""
from __future__ import annotations
import argparse,csv,hashlib,json,re
from collections import Counter,defaultdict
from pathlib import Path

STATES=set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split())
PLACE_TYPES={"city","county","municipality","parks_district","library_system","cultural_agency","civic_government","university_town","tourism_market"}
REQUIRED={"market_id","market_name","place","state","state_code","place_type","priority","existing_region","official_domain","discovery_status","next_action"}
FAMILIES={k:(v,k) for k,v in {"events":'"{place}, {state_code}" official events calendar',"meetings":'"{place}, {state_code}" public meetings agenda calendar',"parks":'"{place}, {state_code}" parks recreation trails official',"trails":'"{place}, {state_code}" trails outdoor recreation official',"libraries":'"{place}, {state_code}" library events calendar',"culture":'"{place}, {state_code}" arts culture museum events official',"volunteer":'"{place}, {state_code}" volunteer opportunities official',"open_data":'"{place}, {state_code}" open data portal',"rss_ics":'"{place}, {state_code}" (RSS OR iCalendar OR ICS) events',"arcgis":'site:{official_domain} (FeatureServer OR MapServer) parks events',"socrata":'site:{official_domain} site:data.* Socrata dataset events',"ckan":'site:{official_domain} CKAN API dataset',"legistar":'site:{official_domain} Legistar meetings agenda',"civicplus":'site:{official_domain} CivicPlus calendar events',"granicus":'site:{official_domain} Granicus meetings agenda',"json_ld":'site:{official_domain} JSON-LD Event schema'}.items()}
PROVIDER_STATUSES=("candidate","discovered","technically_validated","content_validated","approved","active","degraded","paused","retired")
NEGATIVE_CODES=("not_official","duplicate_coverage","insufficient_event_fields","access_restricted","not_in_scope","retired_url","stale_calendar","blocked_robots")
def _domain(v): return bool(re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",v.lower()))
def validate_seeds(path):
    with path.open(encoding="utf-8",newline="") as f: reader=csv.DictReader(f); rows=list(reader); fields=set(reader.fieldnames or [])
    errors=[]; warnings=[]; seen=set(); places=defaultdict(set)
    if missing:=REQUIRED-fields: errors.append({"code":"missing_fields","fields":sorted(missing)})
    for line,row in enumerate(rows,2):
        key=(row.get("market_id",""),row.get("place","").casefold())
        if key in seen: errors.append({"line":line,"code":"duplicate_market_place","value":list(key)})
        seen.add(key); places[row.get("place","").casefold()].add(row.get("market_id",""))
        if row.get("state_code") not in STATES: errors.append({"line":line,"code":"invalid_state_code","value":row.get("state_code")})
        if row.get("place_type") not in PLACE_TYPES: errors.append({"line":line,"code":"invalid_place_type","value":row.get("place_type")})
        try:
            if int(row.get("priority","")) not in (1,2,3): raise ValueError
        except ValueError: errors.append({"line":line,"code":"invalid_priority","value":row.get("priority")})
        if not _domain(row.get("official_domain","")): warnings.append({"line":line,"code":"questionable_domain","value":row.get("official_domain","")})
    for place,markets in places.items():
        if len(markets)>1: warnings.append({"code":"cross_market_place","place":place,"markets":sorted(markets)})
    return {"valid":not errors,"seedCount":len(rows),"errors":errors,"warnings":warnings,"marketCount":len({r.get("market_id") for r in rows}),"placeTypeCounts":dict(Counter(r.get("place_type") for r in rows))}
def _score(r): return (int(r["priority"]),0 if r["existing_region"].lower()=="true" else 1,0 if _domain(r["official_domain"]) else 1)
def _confidence(r,family):
    signals={"official_domain":_domain(r["official_domain"]),"structured_family":family in {"rss_ics","arcgis","socrata","ckan","json_ld"},"existing_coverage":r["existing_region"].lower()=="true"}
    return {"score":round(sum(signals.values())/len(signals),2),"signals":signals}
def _coverage(rows,market_id,queries):
    seeds=[r for r in rows if r["market_id"]==market_id]; families={x["queryFamily"] for x in queries};
    return {"score":round((min(len(seeds),5)/5)*.35+(len({r['place_type'] for r in seeds})/3)*.2+(len(families)/len(FAMILIES))*.25+(sum(r['existing_region'].lower()=='true' for r in seeds)/len(seeds))*.2,2),"seedCount":len(seeds),"placeTypes":sorted({r['place_type'] for r in seeds}),"queryFamilies":len(families),"existingSeedCount":sum(r['existing_region'].lower()=='true' for r in seeds)}
def build_queue(path,query_budget=16):
    report=validate_seeds(path)
    if not report["valid"]: raise ValueError(json.dumps(report,indent=2))
    with path.open(encoding="utf-8",newline="") as f: rows=list(csv.DictReader(f))
    rows.sort(key=lambda r:(_score(r),r["market_id"],r["place"].casefold())); queue=[]; seen=set()
    for r in rows:
        for i,(family,(template,intent)) in enumerate(FAMILIES.items()):
            if i>=query_budget: break
            query=template.format(**r)
            if query in seen: continue
            seen.add(query); digest=hashlib.sha256(f"{r['market_id']}|{r['place']}|{family}|{query}".encode()).hexdigest()[:12]
            queue.append({"queryId":f"nrq-{digest}","marketId":r["market_id"],"market":r["market_name"],"place":r["place"],"state":r["state"],"stateCode":r["state_code"],"placeType":r["place_type"],"marketPriority":int(r["priority"]),"seedPriority":_score(r)[1]+1,"officialDomain":r["official_domain"],"providerStatus":"candidate","humanReview":"not_reviewed","sourceConfidence":_confidence(r,family),"negativeDiscoveryCodes":list(NEGATIVE_CODES),"query":query,"queryFamily":family,"intent":intent,"expectedSourceType":family,"nextAction":r["next_action"],"provenance":{"seedFile":str(path).replace('\\','/'),"discoveryOnly":True}})
    return queue,report,rows
def write_artifacts(seed_path,output):
    queue,report,rows=build_queue(seed_path); families=Counter(x["queryFamily"] for x in queue); markets=defaultdict(lambda:{"seeds":0,"queries":0,"existing":0})
    for r in rows: markets[r["market_id"]]["seeds"]+=1; markets[r["market_id"]]["existing"]+=r["existing_region"].lower()=="true"
    for x in queue: markets[x["marketId"]]["queries"]+=1
    payload={"schemaVersion":2,"kind":"national-region-search-queue","readOnly":True,"publicationState":"research-only","source":str(seed_path).replace('\\','/'),"seedCount":len(rows),"marketCount":report["marketCount"],"queryCount":len(queue),"queryFamilies":dict(sorted(families.items())),"queries":queue}
    output.parent.mkdir(parents=True,exist_ok=True); output.write_text(json.dumps(payload,indent=2,sort_keys=True)+"\n",encoding="utf-8"); base=output.parent
    for market_id in markets: markets[market_id]["coverage"]=_coverage(rows,market_id,[x for x in queue if x["marketId"]==market_id])
    artifacts={"national-seed-validation-report.json":{**report,"publicationState":"research-only"},"national-ranked-review-queue.json":{"kind":"national-ranked-review-queue","readOnly":True,"publicationState":"research-only","items":[{"marketId":r["market_id"],"place":r["place"],"priority":_score(r),"humanReview":"not_reviewed","providerStatus":"candidate","nextAction":r["next_action"]} for r in rows]},"national-market-coverage-summary.json":{"kind":"national-market-coverage-summary","readOnly":True,"publicationState":"research-only","markets":dict(sorted(markets.items()))},"national-query-family-summary.json":{"kind":"national-query-family-summary","readOnly":True,"publicationState":"research-only","families":dict(sorted(families.items()))},"national-needs-human-review.json":{"kind":"national-needs-human-review","readOnly":True,"publicationState":"research-only","items":report["warnings"]},"national-negative-discovery-registry.json":{"kind":"national-negative-discovery-registry","readOnly":True,"publicationState":"research-only","allowedReasonCodes":list(NEGATIVE_CODES),"records":[]}}
    for name,value in artifacts.items(): (base/name).write_text(json.dumps(value,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    return payload
def main():
    p=argparse.ArgumentParser(); p.add_argument("--seeds",type=Path,default=Path("expansion-queues/national-region-seeds.csv")); p.add_argument("--output",type=Path,default=Path("expansion-queues/national-region-search-queue.json")); a=p.parse_args(); x=write_artifacts(a.seeds,a.output); print(f"Validated {x['seedCount']} seeds across {x['marketCount']} markets; wrote {x['queryCount']} research queries")
if __name__=="__main__": main()
