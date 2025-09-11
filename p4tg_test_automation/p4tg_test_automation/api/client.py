import requests
import json
from ..utils.helpers import save_stats
from enum import Enum
from typing import Union

DEFAULT_URL = "http://localhost:8000/api"

class Speed(str, Enum):
    BF_SPEED_10G   = "BF_SPEED_10G"
    BF_SPEED_25G   = "BF_SPEED_25G"
    BF_SPEED_40G   = "BF_SPEED_40G"
    BF_SPEED_100G  = "BF_SPEED_100G"
    BF_SPEED_400G  = "BF_SPEED_400G"

class FEC(str, Enum):
    BF_FEC_TYP_NONE          = "BF_FEC_TYP_NONE"
    BF_FEC_TYP_FC          = "BF_FEC_TYP_FC"
    BF_FEC_TYP_REED_SOLOMON  = "BF_FEC_TYP_REED_SOLOMON"

class AutoNeg(str, Enum):
    PM_AN_DEFAULT       = "PM_AN_DEFAULT"
    PM_AN_ENABLE        = "PM_AN_ENABLE"
    PM_AN_DISABLE       = "PM_AN_DISABLE"


# -------- API boilerplate ---------

class P4TG:
    
    def __init__(self, base_url: str = DEFAULT_URL):
        self.base_url = base_url.rstrip("/")    
    
    def start_traffic_gen(self, req):
        url = f"{self.base_url}/trafficgen"
        response = requests.post(url, json=req)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)
        
    def stop_traffic_gen(self):
        url = f"{self.base_url}/trafficgen"
        response = requests.delete(url)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)    
        
    def get_time_statistics(self, payload_path):
        url = f"{self.base_url}/time_statistics"
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)      
            return ""
        else:
            save_stats("time_stats", response.text, payload_path)
            return json.loads(response.text)
        
    def get_statistics(self, payload_path):
        url = f"{self.base_url}/statistics"
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)      
            return ""
        else:
            save_stats("stats", response.text, payload_path)
            return json.loads(response.text)
            
        
    def configure_port(
        self,
        port: int,
        channel: int,
        speed: Union[Speed, str],
        auto_neg: Union[AutoNeg, str],
        fec: Union[FEC, str],
    ):
        """Configure a front-panel port/channel with speed/FEC/AN."""
        url = f"{self.base_url}/ports"
        req = {
            "front_panel_port": port,
            "channel": channel,
            "speed": speed.value if isinstance(speed, Enum) else speed,
            "fec":   fec.value   if isinstance(fec,   Enum) else fec,
            "auto_neg": auto_neg.value if isinstance(auto_neg, Enum) else auto_neg,
        }
        resp = requests.post(url, json=req)
        if resp.status_code != 201:
            print(f"Error {resp.status_code}, {resp.reason}: {resp.text}")
        return resp