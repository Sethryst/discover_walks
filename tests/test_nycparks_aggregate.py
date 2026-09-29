def test_nycparks_aggregate_parser_contract_source_exists():
    from pathlib import Path
    assert (Path(__file__).parents[1] / 'scripts/acquire_nycparks_aggregate.py').exists()
