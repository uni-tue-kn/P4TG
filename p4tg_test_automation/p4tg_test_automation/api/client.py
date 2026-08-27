import requests
import json
import logging
from pathlib import Path
from ..utils.helpers import save_stats
from enum import Enum
from typing import Union

DEFAULT_URL = "http://localhost:8000/api"


class P4TGAPIError(RuntimeError):
    """Raised when the controller rejects an automation request."""


def require_status(response, expected_status: int, operation: str):
    if response.status_code != expected_status:
        message = (
            f"{operation} failed with HTTP {response.status_code} "
            f"{response.reason}: {response.text}"
        )
        logging.error(message)
        raise P4TGAPIError(message)
    return response


class Speed(str, Enum):
    BF_SPEED_10G   = "BF_SPEED_10G"
    BF_SPEED_25G   = "BF_SPEED_25G"
    BF_SPEED_40G   = "BF_SPEED_40G"
    BF_SPEED_50G   = "BF_SPEED_50G"
    BF_SPEED_100G  = "BF_SPEED_100G"
    BF_SPEED_200G  = "BF_SPEED_200G"
    BF_SPEED_400G  = "BF_SPEED_400G"

class FEC(str, Enum):
    BF_FEC_TYP_NONE          = "BF_FEC_TYP_NONE"
    BF_FEC_TYP_FC          = "BF_FEC_TYP_FC"
    BF_FEC_TYP_REED_SOLOMON  = "BF_FEC_TYP_REED_SOLOMON"

class AutoNeg(str, Enum):
    PM_AN_DEFAULT       = "PM_AN_DEFAULT"
    PM_AN_FORCE_ENABLE  = "PM_AN_FORCE_ENABLE"
    PM_AN_FORCE_DISABLE = "PM_AN_FORCE_DISABLE"


# -------- API boilerplate ---------

class P4TG:
    
    def __init__(self, base_url: str = DEFAULT_URL):
        self.base_url = base_url.rstrip("/")    
    
    def start_traffic_gen(self, req):
        url = f"{self.base_url}/trafficgen"
        logging.info("POST %s", url)
        response = requests.post(url, json=req)
        require_status(response, 200, "Starting traffic generation")
        logging.info("Traffic generator accepted request.")
        return response
        
    def stop_traffic_gen(self):
        url = f"{self.base_url}/trafficgen"
        logging.info("DELETE %s", url)
        response = requests.delete(url)
        require_status(response, 200, "Stopping traffic generation")
        logging.info("Traffic generator stopped.")
        return response

    def get_traffic_gen_status(self):
        """Return the active configuration, or None once orchestration is complete."""
        url = f"{self.base_url}/trafficgen"
        logging.debug("GET %s", url)
        response = requests.get(url)
        if response.status_code == 202:
            return None
        require_status(response, 200, "Reading traffic generation status")
        return response.json()
        
    def get_time_statistics(self, payload_path=None):
        url = f"{self.base_url}/time_statistics"
        logging.debug("GET %s", url)
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)      
            return ""
        else:
            if payload_path is not None:
                save_stats("time_stats", response.text, payload_path)
            return json.loads(response.text)
        
    def get_statistics(self, payload_path=None):
        url = f"{self.base_url}/statistics"
        logging.debug("GET %s", url)
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)      
            return ""
        else:
            if payload_path is not None:
                save_stats("stats", response.text, payload_path)
            return json.loads(response.text)

    def export_report(self, metadata, payload_path=None):
        url = f"{self.base_url}/report"
        logging.info("POST %s", url)
        response = requests.post(url, json=metadata)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)
            return None

        results_dir = Path("results")
        results_dir.mkdir(parents=True, exist_ok=True)
        if payload_path is None:
            filename = "p4tg_report.pdf"
        else:
            filename = f"{Path(payload_path).stem}_report.pdf"
        out_path = results_dir / filename
        out_path.write_bytes(response.content)
        logging.info("Wrote %s.", out_path)
        return out_path

    def get_ports(self):
        url = f"{self.base_url}/ports"
        logging.debug("GET %s", url)
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error {response.status_code}, {response.reason}: ", response.text)
            return ""
        return json.loads(response.text)
            
        
    def configure_port(
        self,
        port: int,
        channel: int,
        speed: Union[Speed, str],
        auto_neg: Union[AutoNeg, str],
        fec: Union[FEC, str],
        channel_count: int | None = None,
    ):
        """Configure a front-panel port/channel with speed/FEC/AN and its active layout."""
        url = f"{self.base_url}/ports"
        logging.info("POST %s for port %s/%s (%s, %s, %s)", url, port, channel, speed, auto_neg, fec)
        req = {
            "front_panel_port": port,
            "channel": channel,
            "speed": speed.value if isinstance(speed, Enum) else speed,
            "fec":   fec.value   if isinstance(fec,   Enum) else fec,
            "auto_neg": auto_neg.value if isinstance(auto_neg, Enum) else auto_neg,
        }
        if channel_count is not None:
            req["channel_count"] = channel_count
        resp = requests.post(url, json=req)
        return require_status(resp, 201, f"Configuring port {port}/{channel}")
